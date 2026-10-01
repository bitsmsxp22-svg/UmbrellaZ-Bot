import crypto from 'node:crypto';
import { Budget, estimateJobCost } from './budget.js';
import { buildConceptPrompt, buildImagePrompt, createConcepts, drawSvgDirectly, parseConcepts } from './director.js';
import { log } from './log.js';
import { sanitizeSvg } from './sanitize.js';
import { rasterToSvg } from './vectorize.js';

export class Semaphore {
  constructor(max) {
    this.max = Math.max(1, max);
    this.active = 0;
    this.waiting = [];
  }

  async run(fn) {
    if (this.active >= this.max) await new Promise((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

export class QueueFullError extends Error {}
export class QuotaError extends Error {
  constructor(until) {
    super('cota esgotada');
    this.until = until;
  }
}
export class JobStateError extends Error {}

// Limite de memória: resultados mais antigos são descartados primeiro.
const MAX_STORED_JOBS = 300;

const isFinished = (job) => job.state === 'done' || job.state === 'error';

/**
 * Gerencia fila, execução e armazenamento temporário (em memória) dos jobs.
 * Cada job produz N amostras; cada amostra fica disponível assim que termina.
 *
 * Dois modos, com os mesmos modelos (GPT-5.6 Sol + GPT Image 2):
 *  - servidor: usa a cota grátis do servidor (escondido do visitante);
 *  - visitante ("client"): quando a cota do servidor acaba, o navegador gera com a cota grátis do
 *    próprio visitante (Puter.js) e envia as imagens para o servidor vetorizar.
 * Um job do servidor que esgota a cota no meio passa o restante para o modo do visitante.
 */
export class JobManager {
  constructor({ provider, config }) {
    this.provider = provider;
    this.config = config;
    this.jobs = new Map();
    this.queue = [];
    this.running = 0;
    this.imageSemaphore = new Semaphore(config.imageConcurrency);
    this.vectorSemaphore = new Semaphore(2);
    this.budget = new Budget({
      provider,
      refill: config.budget?.refill ?? 'hourly',
      checkBalance: config.budget?.checkBalance ?? false,
      jobCost: estimateJobCost(config.samples, config.provider?.imageQuality ?? 'high'),
      dailyCap: config.budget?.dailyCap ?? 0,
    });
    this.stats = { started: 0, done: 0, failed: 0, client: 0 };
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    this.cleanupTimer.unref();
  }

  get queued() {
    return this.queue.length;
  }

  /** Modo que um novo pedido usaria agora (para a interface preparar o navegador). */
  get preferredMode() {
    if (!this.provider) return 'client';
    if (this.config.clientFallback && (this.budget.exhausted || this.queue.length >= this.config.clientQueueThreshold)) return 'client';
    return 'server';
  }

  async create({ brief, refs, transparent }) {
    const { clientFallback } = this.config;
    let server = Boolean(this.provider);
    if (server && clientFallback && this.queue.length >= this.config.clientQueueThreshold) server = false;
    if (server) server = await this.budget.canAfford();

    if (!server && !clientFallback) {
      if (this.budget.exhausted) throw new QuotaError(this.budget.exhaustedUntil);
      server = true;
    }
    if (server && this.queue.length >= this.config.maxQueuedJobs) throw new QueueFullError('fila cheia');
    if (this.jobs.size >= MAX_STORED_JOBS) this.#evictOldestFinished();

    const job = {
      id: crypto.randomBytes(16).toString('hex'),
      createdAt: Date.now(),
      touchedAt: Date.now(),
      state: 'queued',
      stage: 'queued',
      brief,
      refs,
      refsCount: refs.length,
      transparent,
      samples: Array.from({ length: this.config.samples }, (_, index) => ({ index, status: 'pending' })),
      controller: new AbortController(),
    };
    this.jobs.set(job.id, job);
    if (server) {
      this.queue.push(job);
      this.#pump();
    } else {
      this.#toClient(job, 'concepts');
    }
    return job;
  }

  get(id) {
    return this.jobs.get(id);
  }

  #evictOldestFinished() {
    for (const [id, job] of this.jobs) {
      if (isFinished(job)) {
        this.jobs.delete(id);
        if (this.jobs.size < MAX_STORED_JOBS) return;
      }
    }
  }

  #pump() {
    while (this.running < this.config.maxConcurrentJobs && this.queue.length) {
      const job = this.queue.shift();
      this.running += 1;
      this.#execute(job).finally(() => {
        this.running -= 1;
        this.#pump();
      });
    }
  }

  /** Passa o job (ou o que falta dele) para o navegador do visitante. */
  #toClient(job, stage) {
    job.state = 'client';
    job.stage = stage;
    job.clientStage = stage;
    job.refs = null; // o navegador já tem as imagens de referência
    job.touchedAt = Date.now();
    if (stage === 'concepts') {
      job.clientPrompt = buildConceptPrompt({ brief: job.brief, n: this.config.samples, refsCount: job.refsCount });
    }
    this.stats.client += 1;
  }

  async #execute(job) {
    this.stats.started += 1;
    job.state = 'running';
    job.startedAt = Date.now();
    const timer = setTimeout(() => job.controller.abort(new Error('tempo limite do job')), this.config.jobTimeoutMs);
    const signal = job.controller.signal;
    try {
      job.stage = 'concepts';
      let result;
      try {
        result = await createConcepts(this.provider, {
          brief: job.brief, refs: job.refs, n: this.config.samples, signal,
        });
      } catch (err) {
        if (!err?.budget) throw err;
        this.budget.markExhausted();
        if (!this.config.clientFallback) throw err;
        this.#toClient(job, 'concepts');
        log.info(`job ${job.id.slice(0, 8)}: cota do servidor esgotada; conceitos no navegador do visitante`);
        return;
      }
      this.#applyConcepts(job, result);

      job.stage = 'images';
      await Promise.all(result.concepts.map((concept, i) => this.#renderSample(job, job.samples[i], concept, signal)));

      if (job.samples.some((s) => s.status === 'handoff')) {
        this.#toClient(job, 'images');
        log.info(`job ${job.id.slice(0, 8)}: cota do servidor esgotada; imagens restantes no navegador do visitante`);
        return;
      }
      this.#finish(job);
    } catch (err) {
      job.state = 'error';
      job.stage = 'finished';
      job.error = 'Não foi possível gerar agora. Tente novamente em instantes.';
      this.stats.failed += 1;
      log.error(`job ${job.id.slice(0, 8)} falhou: ${err?.message || err}`);
      for (const s of job.samples) if (s.status === 'pending') s.status = 'error';
    } finally {
      clearTimeout(timer);
      job.finishedAt ??= isFinished(job) ? Date.now() : undefined;
      job.refs = null; // libera memória das imagens enviadas
    }
  }

  #applyConcepts(job, { brand, concepts }) {
    job.brand = brand;
    concepts.forEach((c, i) => Object.assign(job.samples[i], {
      title: c.title,
      description: c.description,
      palette: c.palette,
      prompt: buildImagePrompt(c, { brand, transparent: job.transparent }),
      concept: c,
    }));
  }

  #finish(job) {
    const ok = job.samples.filter((s) => s.status === 'done').length;
    job.state = ok ? 'done' : 'error';
    job.stage = 'finished';
    job.finishedAt = Date.now();
    if (!ok) job.error = 'Nenhuma amostra pôde ser gerada.';
    this.stats[ok ? 'done' : 'failed'] += 1;
    log.info(`job ${job.id.slice(0, 8)}: ${ok}/${job.samples.length} amostras em ${Math.round((Date.now() - job.createdAt) / 1000)}s`);
  }

  async #renderSample(job, sample, concept, signal) {
    const tag = `job ${job.id.slice(0, 8)} #${sample.index + 1}`;
    const handoff = () => {
      if (!this.config.clientFallback) return false;
      sample.status = 'handoff';
      return true;
    };
    if (this.budget.exhausted && handoff()) return;
    try {
      const png = await this.imageSemaphore.run(() => {
        if (this.budget.exhausted && this.config.clientFallback) throw Object.assign(new Error('cota esgotada'), { budget: true });
        return this.provider.image({ prompt: sample.prompt, refs: job.refs, transparent: job.transparent, signal });
      });
      sample.svg = sanitizeSvg(await rasterToSvg(png, { transparent: job.transparent }));
      sample.status = 'done';
      return;
    } catch (err) {
      if (signal.aborted) {
        sample.status = 'error';
        return;
      }
      if (err?.budget) {
        this.budget.markExhausted();
        if (handoff()) return;
      }
      if (!this.config.planBSvg) {
        log.error(`${tag}: imagem falhou (${err.message})`);
        sample.status = 'error';
        return;
      }
      log.warn(`${tag}: imagem falhou (${err.message}); plano B com SVG direto`);
    }
    try {
      const svg = await drawSvgDirectly(this.provider, { concept, brand: job.brand, signal });
      sample.svg = sanitizeSvg(svg);
      sample.status = 'done';
    } catch (err) {
      if (err?.budget) this.budget.markExhausted();
      if (err?.budget && handoff()) return;
      log.error(`${tag}: falhou (${err.message})`);
      sample.status = 'error';
    }
  }

  // ---------- Modo do visitante ----------

  #assertClient(job, stage) {
    if (job.state !== 'client' || (stage && job.clientStage !== stage)) {
      throw new JobStateError('etapa inválida para esta geração');
    }
    job.touchedAt = Date.now();
  }

  /** Recebe a resposta do GPT-5.6 Sol gerada no navegador e devolve os prompts das imagens. */
  submitConcepts(job, text) {
    this.#assertClient(job, 'concepts');
    this.#applyConcepts(job, parseConcepts(String(text || '').slice(0, 60_000), { brief: job.brief, n: this.config.samples }));
    for (const s of job.samples) if (s.status === 'pending') s.status = 'handoff';
    job.stage = 'images';
    job.clientStage = 'images';
  }

  #clientSample(job, index) {
    this.#assertClient(job, 'images');
    const sample = job.samples[index];
    if (!sample || sample.status !== 'handoff') throw new JobStateError('amostra indisponível');
    sample.attempts = (sample.attempts || 0) + 1;
    if (sample.attempts > 3) throw new JobStateError('tentativas esgotadas para esta amostra');
    return sample;
  }

  /** Vetoriza uma imagem gerada no navegador do visitante. */
  async submitSampleImage(job, index, buffer) {
    const sample = this.#clientSample(job, index);
    sample.status = 'processing';
    try {
      const svg = await this.vectorSemaphore.run(() => rasterToSvg(buffer, { transparent: job.transparent }));
      sample.svg = sanitizeSvg(svg);
      sample.status = 'done';
    } catch (err) {
      sample.status = 'handoff'; // permite reenviar
      throw err;
    } finally {
      this.#maybeFinishClient(job);
    }
    return sample;
  }

  failSample(job, index) {
    const sample = this.#clientSample(job, index);
    sample.status = 'error';
    this.#maybeFinishClient(job);
    return sample;
  }

  #maybeFinishClient(job) {
    if (job.state === 'client' && job.samples.every((s) => s.status === 'done' || s.status === 'error')) this.#finish(job);
  }

  /** Visão pública do job. No modo do servidor não revela prompts, provedor nem modelos. */
  toPublic(job) {
    const position = job.state === 'queued' ? this.queue.indexOf(job) + 1 : 0;
    const out = {
      id: job.id,
      state: job.state,
      stage: job.stage,
      position,
      error: job.error,
      samples: job.samples.map((s) => ({
        index: s.index,
        status: s.status,
        title: s.title,
        description: s.description,
        palette: s.palette,
      })),
    };
    if (job.state === 'client') {
      const { puter } = this.config;
      out.client = {
        stage: job.clientStage,
        textModel: puter.textModel,
        imageModel: puter.imageModel,
        quality: puter.quality,
        prompt: job.clientStage === 'concepts' ? job.clientPrompt : undefined,
        prompts: job.clientStage === 'images'
          ? job.samples.filter((s) => s.status === 'handoff').map((s) => ({ index: s.index, prompt: s.prompt }))
          : undefined,
      };
    }
    return out;
  }

  cleanup(now = Date.now()) {
    for (const [id, job] of this.jobs) {
      const expired = isFinished(job)
        ? now - (job.finishedAt || job.createdAt) > this.config.jobTtlMs
        : job.state === 'client' && now - job.touchedAt > this.config.jobTtlMs;
      if (expired) this.jobs.delete(id);
    }
  }

  /** Cancela tudo (desligamento gracioso). */
  shutdown() {
    clearInterval(this.cleanupTimer);
    for (const job of this.jobs.values()) {
      if (job.state === 'queued' || job.state === 'running') job.controller.abort(new Error('servidor desligando'));
    }
  }
}
