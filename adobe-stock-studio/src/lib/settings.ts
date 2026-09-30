import { paths } from './paths';
import { DEFAULT_FREE_SITES } from './providers/site-list';
import { readJson, writeJson } from './util';

export type AspectRatio = '3:2' | '2:3' | '16:9' | '1:1' | '4:3';
export type PromptEngine = 'chatgpt' | 'local';
export type ImageProvider = 'free-sites' | 'chatgpt';
export type UpscalerKind = 'realesrgan' | 'sharp';
export type BrowserChannel = 'chrome' | 'msedge' | 'chromium';

export interface Settings {
  /* Produção */
  imagesPerBatch: number;
  maxBatchesPerSession: number;
  pauseBetweenImagesSec: number;
  pauseBetweenBatchesMin: number;
  simulationMode: boolean;
  keepAwake: boolean;

  /* Pesquisa de mercado */
  niches: string[];
  includeSeasonal: boolean;
  researchResultsPerQuery: number;
  researchDeepItems: number;
  researchRefreshHours: number;
  researchExtraParams: string;

  /* Prompts (ChatGPT sem login) e geração (GPT Image 2 sem login) */
  promptEngine: PromptEngine;
  imageProvider: ImageProvider;
  freeSites: string[];
  siteCooldownHours: number;
  aspectRatio: AspectRatio;
  chatgptUrl: string;
  useTemporaryChat: boolean;
  imageTimeoutMin: number;
  rateLimitCooldownMin: number;

  /* Ampliação (IA) */
  upscaler: UpscalerKind;
  realesrganModel: string;
  realesrganPath: string;
  targetLongSide: number;
  jpegQuality: number;

  /* Envio para o Adobe Stock */
  adobeContributorUrl: string;
  autoSubmit: boolean;
  csvApplyWaitSec: number;
  deleteAfterUpload: boolean;

  /* Navegador e arquivos */
  outputDir: string;
  browserChannel: BrowserChannel;
  browserExecutablePath: string;
  headless: boolean;
  selectorOverrides: Record<string, string>;
}

export const DEFAULT_NICHES = [
  'business teamwork office',
  'artificial intelligence technology',
  'abstract background',
  'healthy food',
  'renewable energy sustainability',
  'healthcare doctor',
  'finance money investment',
  'nature landscape',
  'remote work home office',
  'cybersecurity data',
];

export const DEFAULT_SETTINGS: Settings = {
  imagesPerBatch: 5,
  maxBatchesPerSession: 0,
  pauseBetweenImagesSec: 20,
  pauseBetweenBatchesMin: 5,
  simulationMode: false,
  keepAwake: true,

  niches: DEFAULT_NICHES,
  includeSeasonal: true,
  researchResultsPerQuery: 40,
  researchDeepItems: 3,
  researchRefreshHours: 12,
  researchExtraParams: '',

  promptEngine: 'chatgpt',
  imageProvider: 'free-sites',
  freeSites: DEFAULT_FREE_SITES,
  siteCooldownHours: 12,
  aspectRatio: '3:2',
  chatgptUrl: 'https://chatgpt.com/',
  useTemporaryChat: false,
  imageTimeoutMin: 6,
  rateLimitCooldownMin: 30,

  upscaler: 'realesrgan',
  realesrganModel: 'realesrgan-x4plus',
  realesrganPath: '',
  targetLongSide: 6000,
  jpegQuality: 92,

  adobeContributorUrl: 'https://contributor.stock.adobe.com/',
  autoSubmit: true,
  csvApplyWaitSec: 90,
  deleteAfterUpload: true,

  outputDir: '',
  browserChannel: 'chrome',
  browserExecutablePath: '',
  headless: false,
  selectorOverrides: {},
};

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : value === 'true' ? true : value === 'false' ? false : fallback;

const str = (value: unknown, fallback: string): string => (typeof value === 'string' ? value.trim() : fallback);

const url = (value: unknown, fallback: string): string => {
  try {
    const u = new URL(String(value));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : fallback;
  } catch {
    return fallback;
  }
};

const urlList = (value: unknown, fallback: string[]): string[] => {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/) : fallback;
  const list = raw.map((v) => url(String(v).trim(), '')).filter(Boolean);
  return [...new Set(list)].slice(0, 60);
};

/** Normaliza e valida qualquer objeto parcial vindo do disco ou do formulário. */
export function normalizeSettings(input: Partial<Record<keyof Settings, unknown>>): Settings {
  const d = DEFAULT_SETTINGS;
  const niches = Array.isArray(input.niches)
    ? input.niches
    : typeof input.niches === 'string'
      ? input.niches.split(/\r?\n|;/)
      : d.niches;
  const overrides =
    input.selectorOverrides && typeof input.selectorOverrides === 'object' && !Array.isArray(input.selectorOverrides)
      ? Object.fromEntries(
          Object.entries(input.selectorOverrides as Record<string, unknown>)
            .filter(([, v]) => typeof v === 'string' && v.trim())
            .map(([k, v]) => [k, String(v).trim()]),
        )
      : d.selectorOverrides;

  return {
    imagesPerBatch: clamp(input.imagesPerBatch, 1, 50, d.imagesPerBatch),
    maxBatchesPerSession: clamp(input.maxBatchesPerSession, 0, 1000, d.maxBatchesPerSession),
    pauseBetweenImagesSec: clamp(input.pauseBetweenImagesSec, 0, 3600, d.pauseBetweenImagesSec),
    pauseBetweenBatchesMin: clamp(input.pauseBetweenBatchesMin, 0, 1440, d.pauseBetweenBatchesMin),
    simulationMode: bool(input.simulationMode, d.simulationMode),
    keepAwake: bool(input.keepAwake, d.keepAwake),

    niches: niches.map((n) => String(n).trim()).filter(Boolean).slice(0, 40),
    includeSeasonal: bool(input.includeSeasonal, d.includeSeasonal),
    researchResultsPerQuery: clamp(input.researchResultsPerQuery, 10, 100, d.researchResultsPerQuery),
    researchDeepItems: clamp(input.researchDeepItems, 0, 10, d.researchDeepItems),
    researchRefreshHours: clamp(input.researchRefreshHours, 0, 720, d.researchRefreshHours),
    researchExtraParams: str(input.researchExtraParams, d.researchExtraParams),

    promptEngine: oneOf(input.promptEngine, ['chatgpt', 'local'] as const, d.promptEngine),
    imageProvider: oneOf(input.imageProvider, ['free-sites', 'chatgpt'] as const, d.imageProvider),
    freeSites: urlList(input.freeSites, d.freeSites),
    siteCooldownHours: clamp(input.siteCooldownHours, 1, 168, d.siteCooldownHours),
    aspectRatio: oneOf(input.aspectRatio, ['3:2', '2:3', '16:9', '1:1', '4:3'] as const, d.aspectRatio),
    chatgptUrl: url(input.chatgptUrl, d.chatgptUrl),
    useTemporaryChat: bool(input.useTemporaryChat, d.useTemporaryChat),
    imageTimeoutMin: clamp(input.imageTimeoutMin, 1, 30, d.imageTimeoutMin),
    rateLimitCooldownMin: clamp(input.rateLimitCooldownMin, 1, 1440, d.rateLimitCooldownMin),

    upscaler: oneOf(input.upscaler, ['realesrgan', 'sharp'] as const, d.upscaler),
    realesrganModel: str(input.realesrganModel, d.realesrganModel) || d.realesrganModel,
    realesrganPath: str(input.realesrganPath, d.realesrganPath),
    targetLongSide: clamp(input.targetLongSide, 2500, 10000, d.targetLongSide),
    jpegQuality: clamp(input.jpegQuality, 70, 100, d.jpegQuality),

    adobeContributorUrl: url(input.adobeContributorUrl, d.adobeContributorUrl),
    autoSubmit: bool(input.autoSubmit, d.autoSubmit),
    csvApplyWaitSec: clamp(input.csvApplyWaitSec, 0, 1800, d.csvApplyWaitSec),
    deleteAfterUpload: bool(input.deleteAfterUpload, d.deleteAfterUpload),

    outputDir: str(input.outputDir, d.outputDir),
    browserChannel: oneOf(input.browserChannel, ['chrome', 'msedge', 'chromium'] as const, d.browserChannel),
    browserExecutablePath: str(input.browserExecutablePath, d.browserExecutablePath),
    headless: bool(input.headless, d.headless),
    selectorOverrides: overrides,
  };
}

export async function loadSettings(): Promise<Settings> {
  const stored = await readJson<Partial<Settings>>(paths.settings, {});
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...stored });
}

export async function saveSettings(partial: Partial<Record<keyof Settings, unknown>>): Promise<Settings> {
  const current = await loadSettings();
  const next = normalizeSettings({ ...current, ...partial });
  await writeJson(paths.settings, next);
  return next;
}
