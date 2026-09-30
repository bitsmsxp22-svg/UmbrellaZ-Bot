import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Raiz do projeto (onde ficam data/ e tools/). */
export const ROOT = process.env.STOCK_STUDIO_HOME ?? process.cwd();
const DATA = path.join(ROOT, 'data');

export const paths = {
  root: ROOT,
  data: DATA,
  settings: path.join(DATA, 'settings.json'),
  logs: path.join(DATA, 'logs'),
  history: path.join(DATA, 'logs', 'envios.jsonl'),
  thumbs: path.join(DATA, 'thumbs'),
  csvArchive: path.join(DATA, 'csv'),
  state: path.join(DATA, 'state'),
  research: path.join(DATA, 'state', 'pesquisa.json'),
  usedPrompts: path.join(DATA, 'state', 'prompts-usados.json'),
  siteStates: path.join(DATA, 'state', 'sites-gpt-image-2.json'),
  browserProfile: path.join(DATA, 'browser-profile'),
  screenshots: path.join(DATA, 'screenshots'),
  tools: path.join(ROOT, 'tools'),
  realesrgan: path.join(ROOT, 'tools', 'realesrgan'),
};

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Descobre a Área de Trabalho do usuário (Windows com/sem OneDrive, macOS e Linux em PT/EN).
 */
export function detectDesktop(): string {
  const home = os.homedir();
  const candidates = [
    path.join(home, 'Desktop'),
    path.join(home, 'OneDrive', 'Desktop'),
    path.join(home, 'OneDrive', 'Área de Trabalho'),
    path.join(home, 'Área de Trabalho'),
    path.join(home, 'Escritorio'),
  ];
  for (const dir of candidates) {
    try {
      if (fs.statSync(dir).isDirectory()) return dir;
    } catch {
      /* tenta o próximo */
    }
  }
  return candidates[0];
}

/** Pasta onde os lotes são produzidos (padrão: Área de Trabalho/AdobeStock-Producao). */
export function resolveOutputDir(configured: string): string {
  const dir = configured.trim() ? configured.trim() : path.join(detectDesktop(), 'AdobeStock-Producao');
  return ensureDir(dir);
}
