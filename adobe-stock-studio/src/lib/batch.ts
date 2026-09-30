import fs from 'node:fs/promises';
import path from 'node:path';
import type { ImageConcept } from './prompts';
import { randomId, readJson, slugify, timestamp, writeJson } from './util';

export type ItemStatus = 'pending' | 'generated' | 'upscaled' | 'uploaded' | 'failed' | 'skipped';

export interface BatchItem extends ImageConcept {
  id: string;
  filename: string;
  status: ItemStatus;
  attempts: number;
  rawPath?: string;
  finalPath?: string;
  thumb?: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  upscaler?: string;
  /** Onde a imagem foi gerada (ex.: "GPT Image 2 · imagegpt2.com"). */
  generator?: string;
  error?: string;
}

export type BatchStatus = 'producing' | 'ready' | 'uploading' | 'done';

export interface Batch {
  id: string;
  createdAt: string;
  dir: string;
  status: BatchStatus;
  items: BatchItem[];
  csvPath?: string;
  uploadAttempts: number;
}

const MANIFEST = 'lote.json';

/** Cria a pasta do lote na Área de Trabalho com o manifesto (permite retomar se parar no meio). */
export async function createBatch(outputDir: string, concepts: ImageConcept[]): Promise<Batch> {
  const stamp = timestamp();
  const id = `lote-${stamp}`;
  const dir = path.join(outputDir, id);
  await fs.mkdir(dir, { recursive: true });
  const short = stamp.slice(2).replace('-', ''); // AAMMDDhhmmss
  const items: BatchItem[] = concepts.map((c, i) => {
    const nn = String(i + 1).padStart(2, '0');
    return {
      ...c,
      id: `${stamp}-${nn}-${randomId()}`,
      // O CSV do Adobe liga os metadados à imagem pelo nome do arquivo, que deve ser único
      // e ter no máximo 30 caracteres: "business-t-26093019361501.jpg" (29).
      filename: `${slugify(c.title, 10)}-${short}${nn}.jpg`,
      status: 'pending',
      attempts: 0,
    };
  });
  const batch: Batch = { id, createdAt: new Date().toISOString(), dir, status: 'producing', items, uploadAttempts: 0 };
  await saveBatch(batch);
  return batch;
}

export async function saveBatch(batch: Batch): Promise<void> {
  await writeJson(path.join(batch.dir, MANIFEST), batch);
}

/** Procura lotes que ficaram pela metade (produção parada, queda de energia, falha no envio). */
export async function findUnfinishedBatch(outputDir: string): Promise<Batch | null> {
  let entries: string[] = [];
  try {
    entries = (await fs.readdir(outputDir)).filter((e) => e.startsWith('lote-')).sort();
  } catch {
    return null;
  }
  for (const entry of entries) {
    const batch = await readJson<Batch | null>(path.join(outputDir, entry, MANIFEST), null);
    if (batch && batch.status !== 'done') {
      batch.dir = path.join(outputDir, entry);
      return batch;
    }
  }
  return null;
}
