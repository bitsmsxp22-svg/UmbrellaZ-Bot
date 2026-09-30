import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/** Produção interrompida pelo botão "Parar". */
export class StopError extends Error {
  constructor() {
    super('Produção interrompida pelo usuário');
    this.name = 'StopError';
  }
}

/** O navegador não está logado no serviço (ChatGPT ou Adobe). */
export class NeedsLoginError extends Error {
  constructor(
    public service: 'chatgpt' | 'adobe',
    message: string,
  ) {
    super(message);
    this.name = 'NeedsLoginError';
  }
}

/** O ChatGPT avisou que o limite de geração foi atingido. */
export class RateLimitError extends Error {
  constructor(
    message: string,
    public waitMinutes?: number,
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

/** O ChatGPT recusou o prompt (política de conteúdo etc.). */
export class RefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefusedError';
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new StopError();
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new StopError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new StopError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function randomBetween(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}

export function randomId(bytes = 3): string {
  return randomBytes(bytes).toString('hex');
}

/** 20260930-184512 */
export function timestamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-` +
    `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

export function slugify(text: string, max = 60): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, max).replace(/-+$/g, '') || 'imagem';
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Grava JSON de forma atômica (arquivo temporário + rename). */
export async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomId()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

/**
 * Apaga arquivo/pasta sem nunca lançar erro. No Windows, antivírus, indexador ou o próprio
 * navegador podem segurar o arquivo por alguns instantes (EBUSY/EPERM): tenta de novo e,
 * se não der, devolve false e o arquivo fica para a limpeza seguinte.
 */
export async function removeQuiet(target: string | undefined, recursive = false): Promise<boolean> {
  if (!target) return true;
  try {
    await fs.rm(target, { force: true, recursive, maxRetries: 10, retryDelay: 300 });
    return true;
  } catch {
    return false;
  }
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** Nomes de arquivo aceitos pelas rotas que servem arquivos (evita path traversal). */
export function isSafeFileName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name) && !name.includes('..');
}

export function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/** Sorteio ponderado. */
export function weightedPick<T>(list: readonly T[], weight: (item: T) => number): T {
  const total = list.reduce((sum, item) => sum + Math.max(0, weight(item)), 0);
  if (total <= 0) return pick(list);
  let r = Math.random() * total;
  for (const item of list) {
    r -= Math.max(0, weight(item));
    if (r <= 0) return item;
  }
  return list[list.length - 1];
}
