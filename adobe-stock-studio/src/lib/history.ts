import fs from 'node:fs';
import { categoryName } from './categories';
import { ensureDir, paths } from './paths';

export type SentStatus = 'enviado' | 'enviado_e_submetido' | 'simulado';

/** Registro permanente de cada imagem enviada ao Adobe Stock. */
export interface HistoryEntry {
  id: string;
  batchId: string;
  filename: string;
  title: string;
  keywords: string[];
  category: number;
  categoryName: string;
  niche: string;
  inspiration: string;
  inspirationRank: number;
  prompt: string;
  promptEngine: string;
  width: number;
  height: number;
  sizeBytes: number;
  upscaler: string;
  generator: string;
  status: SentStatus;
  sentAt: string;
  deletedFromDesktop: boolean;
  thumb: string | null;
  csvFile: string | null;
}

export function appendHistory(entries: HistoryEntry[]): void {
  if (!entries.length) return;
  ensureDir(paths.logs);
  fs.appendFileSync(paths.history, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
}

export function readHistory(): HistoryEntry[] {
  try {
    return fs
      .readFileSync(paths.history, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as HistoryEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is HistoryEntry => e !== null)
      .reverse();
  } catch {
    return [];
  }
}

export function historySummary(entries = readHistory()) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    total: entries.length,
    today: entries.filter((e) => e.sentAt.startsWith(today)).length,
    submitted: entries.filter((e) => e.status === 'enviado_e_submetido').length,
    simulated: entries.filter((e) => e.status === 'simulado').length,
    batches: new Set(entries.map((e) => e.batchId)).size,
  };
}

/** Exporta o log completo (inclui colunas extras além do padrão do Adobe). */
export function historyCsv(entries = readHistory()): string {
  const esc = (v: string | number | boolean) => `"${String(v).replace(/"/g, '""')}"`;
  const header = ['Data', 'Lote', 'Arquivo', 'Titulo', 'Palavras-chave', 'Categoria', 'Nicho', 'Inspiracao (rank)', 'Prompt', 'Resolucao', 'Tamanho (MB)', 'Gerada em', 'Ampliacao', 'Status', 'Apagado do desktop'];
  const rows = entries.map((e) =>
    [
      e.sentAt,
      e.batchId,
      e.filename,
      e.title,
      e.keywords.join(', '),
      categoryName(e.category),
      e.niche,
      `#${e.inspirationRank} ${e.inspiration}`,
      e.prompt,
      `${e.width}x${e.height}`,
      (e.sizeBytes / 1048576).toFixed(1),
      e.generator ?? '',
      e.upscaler,
      e.status,
      e.deletedFromDesktop ? 'sim' : 'nao',
    ]
      .map(esc)
      .join(','),
  );
  return [header.map(esc).join(','), ...rows].join('\n') + '\n';
}
