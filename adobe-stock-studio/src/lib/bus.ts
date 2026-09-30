import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, paths } from './paths';

export type LogLevel = 'info' | 'success' | 'warn' | 'error';

export interface LogLine {
  ts: string;
  level: LogLevel;
  message: string;
}

type Globals = typeof globalThis & {
  __stockStudioBus?: EventEmitter;
  __stockStudioLogBuffer?: LogLine[];
};
const g = globalThis as Globals;

/** Barramento de eventos do servidor (status, log, pesquisa) — alimenta o SSE do painel. */
export const bus: EventEmitter = (g.__stockStudioBus ??= new EventEmitter());
bus.setMaxListeners(200);

const buffer: LogLine[] = (g.__stockStudioLogBuffer ??= []);
const MAX_LINES = 500;

function write(level: LogLevel, message: string): void {
  const line: LogLine = { ts: new Date().toISOString(), level, message };
  buffer.push(line);
  if (buffer.length > MAX_LINES) buffer.splice(0, buffer.length - MAX_LINES);
  bus.emit('log', line);

  const tag = { info: 'INFO', success: ' OK ', warn: 'AVISO', error: 'ERRO' }[level];
  const text = `[${line.ts}] [${tag}] ${message}`;
  (level === 'error' ? console.error : console.log)(text);
  try {
    ensureDir(paths.logs);
    const file = path.join(paths.logs, `atividade-${line.ts.slice(0, 10)}.log`);
    fs.appendFileSync(file, text + '\n', 'utf8');
  } catch {
    /* log em disco é opcional */
  }
}

export const log = {
  info: (m: string) => write('info', m),
  success: (m: string) => write('success', m),
  warn: (m: string) => write('warn', m),
  error: (m: string) => write('error', m),
};

export function recentLogs(limit = 200): LogLine[] {
  return buffer.slice(-limit);
}
