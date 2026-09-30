import crypto from 'node:crypto';
import { buildImagePrompt, createConcepts, drawSvgDirectly } from './director.js';
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

// Limite de memória: resultados mais antigos são descartados primeiro.
const MAX_STORED_JOBS = 300;

/**
 * Gerencia fila, execução e armazenamento temporário (em memória) dos jobs.
 * Cada job produz N amostras; cada amostra fica disponível assim que termina.
 */
export class JobManager {
  constructor({ provider, config }) {
    this.provider = provider;
    this.config = config;
    this.jobs = new Map();
    this.queue = [];
    this.running = 0;
    this.imageSemaphore = new Semaphore(config.imageConcurrency);
    this.stats = { started: 0, done: 0, failed: 0 };
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    this.cleanupTimer.unref();
  }

  get queued() {
    return this.queue.length;
  }

  create({ brief, refs, transparent }) {
    if (this.queue.length >= this.config.maxQueuedJobs) throw new QueueFullError('fila cheia');
    if (this.jobs.size >= MAX_STORED_JOBS) this.#evictOldestFinished();
    const id = crypto.randomBytes(16).toString('hex');
    const job = {
      id,
      createdAt: Date.now(),
      state: 'queued',
      stage: 'queued',
      brief,
      refs,
      transparent,
      samples: Array.from({ length: this.config.samples }, (_, index) => ({ index, status: 'pending' })),
      controller: new AbortController(),
    };
    this.jobs.set(id, job);
    this.queue.push(job);
    this.#pump();
    return job;
  }

  get(id) {
    return this.jobs.get(id);
  }

  #evictOldestFinished() {
    for (const [id, job] of this.jobs) {
      if (job.state === 'done' || job.state === 'error') {
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

  async #execute(job) {
    this.stats.started += 1;
    job.state = 'running';
    job.startedAt = Date.now();
    const timer = setTimeout(() => job.controller.abort(new Error('tempo limite do job')), this.config.jobTimeoutMs);
    const signal = job.controller.signal;
    try {
      job.stage = 'concepts';
      const { brand, concepts } = await createConcepts(this.provider, {
        brief: job.brief, refs: job.refs, n: this.config.samples, signal,
      });
      job.brand = brand;
      concepts.forEach((c, i) => Object.assign(job.samples[i], {
        title: c.title, description: c.description, palette: c.palette,
      }));

      job.stage = 'images';
      await Promise.all(concepts.map((concept, i) => this.#renderSample(job, job.samples[i], concept, signal)));

      const ok = job.samples.filter((s) => s.status === 'done').length;
      job.state = ok ? 'done' : 'error';
      job.stage = 'finished';
      if (!ok) job.error = 'Nenhuma amostra pôde ser gerada.';
      this.stats[ok ? 'done' : 'failed'] += 1;
      log.info(`job ${job.id.slice(0, 8)}: ${ok}/${job.samples.length} amostras em ${Math.round((Date.now() - job.startedAt) / 1000)}s`);
    } catch (err) {
      job.state = 'error';
      job.stage = 'finished';
      job.error = 'Não foi possível gerar agora. Tente novamente em instantes.';
      this.stats.failed += 1;
      log.error(`job ${job.id.slice(0, 8)} falhou: ${err?.message || err}`);
      for (const s of job.samples) if (s.status === 'pending') s.status = 'error';
    } finally {
      clearTimeout(timer);
      job.finishedAt = Date.now();
      job.refs = null; // libera memória das imagens enviadas
    }
  }

  async #renderSample(job, sample, concept, signal) {
    const tag = `job ${job.id.slice(0, 8)} #${sample.index + 1}`;
    try {
      const png = await this.imageSemaphore.run(() => this.provider.image({
        prompt: buildImagePrompt(concept, { brand: job.brand, transparent: job.transparent }),
        refs: job.refs,
        transparent: job.transparent,
        signal,
      }));
      sample.svg = sanitizeSvg(await rasterToSvg(png, { transparent: job.transparent }));
      sample.status = 'done';
      return;
    } catch (err) {
      if (signal.aborted) {
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
      log.error(`${tag}: falhou (${err.message})`);
      sample.status = 'error';
    }
  }

  /** Visão pública do job: sem prompts, sem provedor, sem modelos. */
  toPublic(job) {
    const position = job.state === 'queued' ? this.queue.indexOf(job) + 1 : 0;
    return {
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
  }

  cleanup(now = Date.now()) {
    for (const [id, job] of this.jobs) {
      const finished = job.state === 'done' || job.state === 'error';
      if (finished && now - (job.finishedAt || job.createdAt) > this.config.jobTtlMs) this.jobs.delete(id);
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
