import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { uploadBatchToAdobe, type UploadOutcome } from './adobe';
import { createBatch, findUnfinishedBatch, saveBatch, type Batch, type BatchItem } from './batch';
import { browser } from './browser';
import { bus, log } from './bus';
import { categoryName } from './categories';
import { ChatGPTWeb } from './chatgpt';
import { buildAdobeCsv } from './csv';
import { appendHistory, type HistoryEntry } from './history';
import { ensureDir, paths, resolveOutputDir } from './paths';
import { developConcepts } from './prompts';
import { runResearch } from './research';
import { loadSettings, type Settings } from './settings';
import { simulatedImage } from './simulate';
import { makeThumb, upscaleForAdobe } from './upscale';
import { NeedsLoginError, RateLimitError, RefusedError, StopError, errorMessage, sleep, throwIfAborted } from './util';

export type Stage =
  | 'idle'
  | 'starting'
  | 'research'
  | 'prompts'
  | 'generating'
  | 'upscaling'
  | 'csv'
  | 'uploading'
  | 'cleanup'
  | 'waiting'
  | 'cooldown'
  | 'stopping'
  | 'login'
  | 'error'
  | 'finished';

export const STAGE_LABELS: Record<Stage, string> = {
  idle: 'Parado',
  starting: 'Iniciando',
  research: 'Pesquisando as mais vendidas',
  prompts: 'Desenvolvendo prompts',
  generating: 'Gerando imagem (GPT Image)',
  upscaling: 'Ampliando com IA',
  csv: 'Montando CSV',
  uploading: 'Enviando ao Adobe Stock',
  cleanup: 'Registrando log e limpando o desktop',
  waiting: 'Aguardando',
  cooldown: 'Pausa por limite do ChatGPT',
  stopping: 'Parando…',
  login: 'Login necessário',
  error: 'Erro',
  finished: 'Concluído',
};

export interface ItemView {
  id: string;
  title: string;
  niche: string;
  status: BatchItem['status'];
  thumbUrl: string | null;
  prompt: string;
  keywords: string[];
  category: string;
  inspiration: string;
  inspirationRank: number;
  engine: string;
  width?: number;
  height?: number;
  upscaler?: string;
  error?: string;
}

export interface EngineStatus {
  running: boolean;
  stage: Stage;
  stageLabel: string;
  message: string;
  startedAt: string | null;
  cycle: number;
  simulation: boolean;
  batch: { id: string; dir: string; total: number; ready: number; items: ItemView[] } | null;
  current: { index: number; total: number; title: string; prompt: string; niche: string; startedAt: string } | null;
  research: { index: number; total: number; query: string } | null;
  counters: { generated: number; upscaled: number; uploaded: number; failed: number; batches: number };
  waitUntil: string | null;
  lastError: string | null;
  needsLogin: 'chatgpt' | 'adobe' | null;
}

const initialStatus = (): EngineStatus => ({
  running: false,
  stage: 'idle',
  stageLabel: STAGE_LABELS.idle,
  message: 'Pronto. Aperte "Ligar produção" para começar.',
  startedAt: null,
  cycle: 0,
  simulation: false,
  batch: null,
  current: null,
  research: null,
  counters: { generated: 0, upscaled: 0, uploaded: 0, failed: 0, batches: 0 },
  waitUntil: null,
  lastError: null,
  needsLogin: null,
});

const MAX_ATTEMPTS = 2;
const MAX_CONSECUTIVE_FAILURES = 4;

class ProductionEngine {
  status: EngineStatus = initialStatus();
  private controller: AbortController | null = null;
  private loop: Promise<void> | null = null;
  private chat: ChatGPTWeb | null = null;
  private consecutiveFailures = 0;
  private cooldownUntil = 0;

  constructor() {
    bus.on('research-progress', (p: EngineStatus['research']) => {
      this.status.research = p;
      this.emit();
    });
  }

  isRunning(): boolean {
    return this.loop !== null;
  }

  start(): { ok: boolean; message: string } {
    if (this.loop) return { ok: false, message: 'A produção já está ligada.' };
    const controller = new AbortController();
    this.controller = controller;
    this.status = { ...initialStatus(), running: true, startedAt: new Date().toISOString() };
    this.consecutiveFailures = 0;
    this.cooldownUntil = 0;
    this.set('starting', 'Carregando configurações…');
    this.loop = this.run(controller.signal).finally(() => {
      this.loop = null;
      this.controller = null;
      this.chat = null;
    });
    return { ok: true, message: 'Produção ligada.' };
  }

  async stop(): Promise<{ ok: boolean; message: string }> {
    if (!this.loop || !this.controller) return { ok: false, message: 'A produção já está parada.' };
    this.set('stopping', 'Interrompendo a etapa atual…');
    this.controller.abort();
    // Fecha o navegador para interromper na hora qualquer espera do Playwright.
    await browser.close();
    await Promise.race([this.loop, sleep(20_000)]).catch(() => undefined);
    return { ok: true, message: 'Produção parada. O lote atual será retomado na próxima vez.' };
  }

  private emit(): void {
    bus.emit('status', this.status);
  }

  private set(stage: Stage, message: string): void {
    this.status.stage = stage;
    this.status.stageLabel = STAGE_LABELS[stage];
    this.status.message = message;
    if (stage !== 'research') this.status.research = null;
    this.emit();
  }

  private viewBatch(batch: Batch | null): void {
    if (!batch) {
      this.status.batch = null;
      return;
    }
    this.status.batch = {
      id: batch.id,
      dir: batch.dir,
      total: batch.items.length,
      ready: batch.items.filter((i) => i.status === 'upscaled' || i.status === 'uploaded').length,
      items: batch.items.map((i) => ({
        id: i.id,
        title: i.title,
        niche: i.niche,
        status: i.status,
        thumbUrl: i.thumb ? `/api/file/thumb/${i.thumb}` : null,
        prompt: i.prompt,
        keywords: i.keywords.slice(0, 15),
        category: categoryName(i.category),
        inspiration: i.inspiration,
        inspirationRank: i.inspirationRank,
        engine: i.engine,
        width: i.width,
        height: i.height,
        upscaler: i.upscaler,
        error: i.error,
      })),
    };
    this.emit();
  }

  private async wait(ms: number, stage: Stage, message: string, signal: AbortSignal): Promise<void> {
    if (ms <= 0) return;
    this.status.waitUntil = new Date(Date.now() + ms).toISOString();
    this.set(stage, message);
    try {
      await sleep(ms, signal);
    } finally {
      this.status.waitUntil = null;
    }
  }

  private async chatClient(settings: Settings, signal: AbortSignal): Promise<ChatGPTWeb> {
    this.chat ??= await ChatGPTWeb.open(settings, signal);
    return this.chat;
  }

  private async run(signal: AbortSignal): Promise<void> {
    let batchesDone = 0;
    let emptyBatches = 0;
    try {
      let settings = await loadSettings();
      log.info(settings.simulationMode ? 'Produção ligada em MODO SIMULAÇÃO (nada é enviado de verdade).' : 'Produção ligada.');

      while (!signal.aborted) {
        settings = await loadSettings(); // mudanças nas configurações valem a partir do próximo lote
        this.status.simulation = settings.simulationMode;
        this.status.cycle++;
        const outputDir = resolveOutputDir(settings.outputDir);

        let batch = await findUnfinishedBatch(outputDir);
        if (batch) {
          log.info(`Retomando ${batch.id} (${batch.items.length} imagens) em ${batch.dir}.`);
        } else {
          this.set('research', 'Pesquisando as imagens mais baixadas do Adobe Stock…');
          const snapshot = await runResearch(settings, signal);
          this.set('prompts', 'Criando prompts com base no ranking das mais vendidas…');
          const concepts = await developConcepts(
            snapshot,
            settings.imagesPerBatch,
            settings,
            settings.simulationMode ? null : () => this.chatClient(settings, signal),
          );
          batch = await createBatch(outputDir, concepts);
          log.success(`${batch.id} criado com ${batch.items.length} prompts em ${batch.dir}.`);
        }
        this.viewBatch(batch);

        await this.produce(batch, settings, signal);
        const ready = batch.items.filter((i) => i.status === 'upscaled');
        if (ready.length === 0) {
          emptyBatches++;
          log.error(`Nenhuma imagem de ${batch.id} ficou pronta.`);
          batch.status = 'done';
          await saveBatch(batch);
          if (emptyBatches >= 2) throw new Error('Dois lotes seguidos sem nenhuma imagem pronta. Verifique o ChatGPT no navegador.');
          continue;
        }
        emptyBatches = 0;

        const csvPath = await this.writeCsv(batch, ready);
        await this.upload(batch, ready, csvPath, settings, signal);
        batchesDone++;
        this.status.counters.batches++;
        this.viewBatch(batch);

        if (settings.maxBatchesPerSession > 0 && batchesDone >= settings.maxBatchesPerSession) {
          log.success(`Limite de ${settings.maxBatchesPerSession} lote(s) por sessão atingido. Produção encerrada.`);
          this.set('finished', `Produção concluída: ${batchesDone} lote(s) enviados.`);
          break;
        }
        const cooldownLeft = Math.max(0, this.cooldownUntil - Date.now());
        const pause = Math.max(settings.pauseBetweenBatchesMin * 60_000, cooldownLeft);
        await this.wait(
          settings.simulationMode ? Math.min(pause, 5000) : pause,
          cooldownLeft > 0 ? 'cooldown' : 'waiting',
          cooldownLeft > 0 ? 'Aguardando o limite do ChatGPT liberar para o próximo lote…' : 'Próximo lote em breve…',
          signal,
        );
      }
    } catch (err) {
      if (err instanceof StopError || signal.aborted) {
        log.info('Produção parada pelo usuário.');
        this.set('idle', 'Produção parada. O lote em andamento será retomado quando ligar de novo.');
      } else if (err instanceof NeedsLoginError) {
        this.status.needsLogin = err.service;
        this.status.lastError = err.message;
        log.error(err.message);
        this.set('login', err.message);
      } else {
        this.status.lastError = errorMessage(err);
        log.error(`Produção interrompida: ${errorMessage(err)}`);
        this.set('error', errorMessage(err));
      }
    } finally {
      this.status.running = false;
      this.status.current = null;
      this.status.waitUntil = null;
      // No caso de login pendente o navegador fica aberto para o usuário entrar na conta.
      if (this.status.stage !== 'login') await browser.close();
      this.emit();
    }
  }

  /** Gera e amplia cada imagem do lote, salvando o progresso no manifesto. */
  private async produce(batch: Batch, settings: Settings, signal: AbortSignal): Promise<void> {
    batch.status = 'producing';
    let i = 0;
    while (i < batch.items.length) {
      throwIfAborted(signal);
      const item = batch.items[i];
      const done = ['upscaled', 'uploaded', 'skipped'].includes(item.status) || (item.status === 'failed' && item.attempts >= MAX_ATTEMPTS);
      if (done) {
        i++;
        continue;
      }
      const label = `Imagem ${i + 1}/${batch.items.length}: ${item.title}`;
      this.status.current = { index: i + 1, total: batch.items.length, title: item.title, prompt: item.prompt, niche: item.niche, startedAt: new Date().toISOString() };

      try {
        if (item.status === 'pending' || item.status === 'failed') {
          this.set('generating', `${label} — gerando no ${settings.simulationMode ? 'simulador' : 'ChatGPT'}…`);
          const buffer = settings.simulationMode
            ? await simulatedImage(item.title, settings.aspectRatio)
            : await (await this.chatClient(settings, signal)).generateImage(item.prompt);
          const meta = await sharp(buffer).metadata();
          const ext = meta.format === 'jpeg' ? 'jpg' : (meta.format ?? 'png');
          item.rawPath = path.join(batch.dir, `${path.parse(item.filename).name}.original.${ext}`);
          await fs.writeFile(item.rawPath, buffer);
          ensureDir(paths.thumbs);
          item.thumb = `${item.id}.webp`;
          await makeThumb(item.rawPath, path.join(paths.thumbs, item.thumb));
          item.status = 'generated';
          item.error = undefined;
          this.status.counters.generated++;
          await saveBatch(batch);
          this.viewBatch(batch);
          log.success(`Imagem gerada (${meta.width}×${meta.height}): ${item.title}`);
        }

        if (item.status === 'generated' && item.rawPath) {
          this.set('upscaling', `${label} — ampliando para o padrão do Adobe Stock…`);
          const finalPath = path.join(batch.dir, item.filename);
          const r = await upscaleForAdobe(item.rawPath, finalPath, settings, signal);
          Object.assign(item, { finalPath, width: r.width, height: r.height, sizeBytes: r.sizeBytes, upscaler: r.method, status: 'upscaled' as const });
          await fs.rm(item.rawPath, { force: true });
          this.status.counters.upscaled++;
          await saveBatch(batch);
          this.viewBatch(batch);
          log.success(`Ampliada para ${r.width}×${r.height} (${((r.width * r.height) / 1e6).toFixed(1)} MP, ${(r.sizeBytes / 1048576).toFixed(1)} MB) com ${r.method}.`);
        }
        this.consecutiveFailures = 0;
        i++;
      } catch (err) {
        if (err instanceof StopError || signal.aborted) throw new StopError();
        if (err instanceof NeedsLoginError) throw err;
        if (err instanceof RateLimitError) {
          const minutes = err.waitMinutes ?? settings.rateLimitCooldownMin;
          log.warn(`${err.message}`);
          const readyCount = batch.items.filter((x) => x.status === 'upscaled').length;
          if (readyCount > 0) {
            // Aproveita a pausa: envia o que já está pronto e deixa o resto para o próximo lote.
            this.cooldownUntil = Date.now() + minutes * 60_000;
            for (const rest of batch.items.slice(i)) {
              if (rest.status === 'pending' || rest.status === 'failed') {
                rest.status = 'skipped';
                rest.error = 'adiada por limite do ChatGPT';
              }
            }
            await saveBatch(batch);
            this.viewBatch(batch);
            log.info(`Enviando as ${readyCount} imagens prontas enquanto o limite do ChatGPT não libera (${minutes} min).`);
            return;
          }
          await this.wait(minutes * 60_000, 'cooldown', `Limite do ChatGPT atingido. Retomando em ${minutes} min…`, signal);
          continue;
        }

        item.attempts = err instanceof RefusedError ? MAX_ATTEMPTS : item.attempts + 1;
        item.status = 'failed';
        item.error = errorMessage(err);
        this.status.counters.failed++;
        this.consecutiveFailures++;
        await saveBatch(batch);
        this.viewBatch(batch);
        log.error(`Falha na ${label}: ${item.error}${item.attempts < MAX_ATTEMPTS ? ' — tentando de novo.' : ''}`);
        if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          throw new Error(`${MAX_CONSECUTIVE_FAILURES} falhas seguidas. Última: ${item.error}`);
        }
        continue;
      }

      if (i < batch.items.length && settings.pauseBetweenImagesSec > 0) {
        const ms = settings.simulationMode ? 800 : settings.pauseBetweenImagesSec * 1000;
        await this.wait(ms, 'waiting', 'Pausa curta entre imagens (evita bloqueios)…', signal);
      }
    }
    this.status.current = null;
  }

  /** CSV no formato do Adobe (Filename, Title, Keywords, Category, Releases). */
  private async writeCsv(batch: Batch, ready: BatchItem[]): Promise<string> {
    this.set('csv', `Montando o CSV de ${ready.length} imagens…`);
    const csv = buildAdobeCsv(ready.map((i) => ({ filename: i.filename, title: i.title, keywords: i.keywords, category: i.category })));
    const csvPath = path.join(batch.dir, `${batch.id}.csv`);
    await fs.writeFile(csvPath, csv, 'utf8');
    ensureDir(paths.csvArchive);
    await fs.copyFile(csvPath, path.join(paths.csvArchive, `${batch.id}.csv`));
    batch.csvPath = csvPath;
    batch.status = 'ready';
    await saveBatch(batch);
    log.success(`CSV criado: ${csvPath}`);
    return csvPath;
  }

  private async upload(batch: Batch, ready: BatchItem[], csvPath: string, settings: Settings, signal: AbortSignal): Promise<void> {
    this.set('uploading', `Enviando ${ready.length} imagens + CSV ao Adobe Stock…`);
    batch.status = 'uploading';
    batch.uploadAttempts++;
    await saveBatch(batch);

    let outcome: UploadOutcome;
    if (settings.simulationMode) {
      for (const [n, item] of ready.entries()) {
        this.set('uploading', `Simulando envio ${n + 1}/${ready.length}: ${item.filename}`);
        await sleep(600, signal);
      }
      outcome = { confirmed: ready.map((i) => i.filename), missing: [], portalReportedSuccess: true, csvSent: true, submitted: false, notes: ['simulação'] };
    } else {
      outcome = await uploadBatchToAdobe(
        ready.map((i) => ({ path: i.finalPath!, filename: i.filename })),
        csvPath,
        settings,
        signal,
        batch.uploadAttempts > 1,
      );
    }

    const accepted = new Set(outcome.confirmed.length ? outcome.confirmed : outcome.portalReportedSuccess ? ready.map((i) => i.filename) : []);
    if (accepted.size === 0) {
      const reason = outcome.notes.join('; ') || 'sem confirmação do portal';
      if (batch.uploadAttempts >= 3) {
        batch.status = 'done';
        await saveBatch(batch);
        log.error(`${batch.id}: 3 tentativas de envio sem confirmação (${reason}). As imagens e o CSV ficaram em ${batch.dir} para envio manual.`);
      } else {
        batch.status = 'ready';
        await saveBatch(batch);
        log.error(`${batch.id}: envio não confirmado (${reason}). Vou tentar de novo no próximo ciclo.`);
      }
      return;
    }
    for (const note of outcome.notes) log.warn(`Envio: ${note}`);

    this.set('cleanup', 'Registrando o log de envio e apagando as imagens do desktop…');
    const sentAt = new Date().toISOString();
    const status: HistoryEntry['status'] = settings.simulationMode ? 'simulado' : outcome.submitted ? 'enviado_e_submetido' : 'enviado';
    const entries: HistoryEntry[] = [];
    for (const item of ready) {
      if (!accepted.has(item.filename)) continue;
      let deleted = false;
      if (settings.deleteAfterUpload && item.finalPath) {
        await fs.rm(item.finalPath, { force: true });
        deleted = true;
      }
      item.status = 'uploaded';
      this.status.counters.uploaded++;
      entries.push({
        id: item.id,
        batchId: batch.id,
        filename: item.filename,
        title: item.title,
        keywords: item.keywords,
        category: item.category,
        categoryName: categoryName(item.category),
        niche: item.niche,
        inspiration: item.inspiration,
        inspirationRank: item.inspirationRank,
        prompt: item.prompt,
        promptEngine: item.engine,
        width: item.width ?? 0,
        height: item.height ?? 0,
        sizeBytes: item.sizeBytes ?? 0,
        upscaler: item.upscaler ?? '',
        status,
        sentAt,
        deletedFromDesktop: deleted,
        thumb: item.thumb ?? null,
        csvFile: `${batch.id}.csv`,
      });
    }
    appendHistory(entries);
    bus.emit('history', entries.length);

    const leftovers = ready.filter((i) => !accepted.has(i.filename));
    batch.status = 'done';
    if (settings.deleteAfterUpload && leftovers.length === 0) {
      await fs.rm(batch.dir, { recursive: true, force: true });
    } else {
      await saveBatch(batch);
    }
    if (leftovers.length) {
      log.warn(`${leftovers.length} imagem(ns) não confirmada(s) no portal ficaram em ${batch.dir}: ${leftovers.map((i) => i.filename).join(', ')}`);
    }
    log.success(
      `${batch.id} enviado: ${entries.length} imagem(ns) registradas no log${settings.deleteAfterUpload ? ' e apagadas do desktop' : ''}.` +
        (status === 'enviado_e_submetido' ? ' Enviadas para revisão como IA generativa.' : ''),
    );
  }
}

type Globals = typeof globalThis & { __stockStudioEngine?: ProductionEngine };
const g = globalThis as Globals;
export const engine: ProductionEngine = (g.__stockStudioEngine ??= new ProductionEngine());
