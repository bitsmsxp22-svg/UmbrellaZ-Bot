import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Carrega .env (se existir) sem dependência extra. Variáveis já definidas no ambiente têm prioridade.
const envFile = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envFile);
}

const env = process.env;

function int(name, fallback) {
  const n = Number.parseInt(env[name] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function list(name, fallback) {
  const raw = env[name];
  if (raw === undefined) return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function bool(name, fallback) {
  const raw = (env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'sim', 'on'].includes(raw);
}

// Presets de provedores compatíveis com a API OpenAI.
// A chave fica SOMENTE no servidor; o navegador nunca vê provedor, modelo ou chave.
const PRESETS = {
  pollinations: {
    baseUrl: 'https://gen.pollinations.ai/v1',
    keyEnv: 'POLLINATIONS_API_KEY',
    textModel: 'openai/gpt-5.6-sol',
    textFallbacks: ['openai/gpt-5.5'],
    imageModel: 'openai/gpt-image-2',
    imageFallbacks: ['openai/gpt-image-1.5'],
    imageExtras: { response_format: 'b64_json' },
    editImageField: 'image',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    textModel: 'gpt-5.6-sol',
    textFallbacks: ['gpt-5.5'],
    imageModel: 'gpt-image-2',
    imageFallbacks: ['gpt-image-1.5'],
    imageExtras: { output_format: 'png' },
    transparentExtras: { background: 'transparent' },
    editImageField: 'image[]',
  },
};

// `node src/server.js --production` funciona igual no Windows, Linux e macOS.
if (process.argv.includes('--production')) env.NODE_ENV = 'production';
const isProduction = env.NODE_ENV === 'production';
const explicitProvider = (env.PROVIDER || '').trim().toLowerCase();
let providerName = explicitProvider;
const preset = PRESETS[providerName] || PRESETS.pollinations;
const apiKey = env.AI_API_KEY || env[preset.keyEnv] || '';

if (!providerName) providerName = apiKey ? 'pollinations' : 'mock';

export const config = {
  isProduction,
  port: int('PORT', 3000),
  host: env.HOST || '0.0.0.0',
  // Atrás do nginx/Plesk o IP real vem no X-Forwarded-For.
  trustProxy: env.TRUST_PROXY ? (Number(env.TRUST_PROXY) || env.TRUST_PROXY) : (isProduction ? 1 : false),
  publicDir: path.join(ROOT_DIR, isProduction && fs.existsSync(path.join(ROOT_DIR, 'dist/public')) ? 'dist/public' : 'public'),

  provider: {
    name: providerName,
    baseUrl: (env.AI_BASE_URL || preset.baseUrl).replace(/\/+$/, ''),
    apiKey,
    textModels: [env.TEXT_MODEL || preset.textModel, ...list('TEXT_FALLBACK_MODELS', preset.textFallbacks)],
    imageModels: [env.IMAGE_MODEL || preset.imageModel, ...list('IMAGE_FALLBACK_MODELS', preset.imageFallbacks)],
    imageExtras: preset.imageExtras || {},
    transparentExtras: preset.transparentExtras || {},
    editImageField: preset.editImageField || 'image',
    reasoningEffort: env.REASONING_EFFORT || 'low',
    imageSize: env.IMAGE_SIZE || '1024x1024',
    imageQuality: env.IMAGE_QUALITY || 'high',
    textTimeoutMs: int('TEXT_TIMEOUT_MS', 90_000),
    imageTimeoutMs: int('IMAGE_TIMEOUT_MS', 240_000),
    maxRetries: int('MAX_RETRIES', 2),
  },

  samples: Math.min(Math.max(int('SAMPLES', 5), 1), 8),
  // Limites de operação 24/7
  maxConcurrentJobs: int('MAX_CONCURRENT_JOBS', 2),
  maxQueuedJobs: int('MAX_QUEUED_JOBS', 20),
  imageConcurrency: int('IMAGE_CONCURRENCY', 5),
  jobTimeoutMs: int('JOB_TIMEOUT_MS', 8 * 60_000),
  jobTtlMs: int('JOB_TTL_MS', 60 * 60_000),
  rateLimit: {
    max: int('RATE_LIMIT_MAX', 6),
    windowMs: int('RATE_LIMIT_WINDOW_MS', 60 * 60_000),
  },
  upload: {
    maxFiles: int('UPLOAD_MAX_FILES', 3),
    maxBytes: int('UPLOAD_MAX_MB', 8) * 1024 * 1024,
  },
  promptMaxChars: int('PROMPT_MAX_CHARS', 1200),
  exposeErrors: bool('EXPOSE_ERRORS', !isProduction),
  // Sites que podem embutir o app via <iframe> (ex.: https://seusite.com.br). Padrão: só o próprio domínio.
  frameAncestors: ["'self'", ...list('FRAME_ANCESTORS', [])],
};

export function assertProductionConfig() {
  if (config.isProduction && explicitProvider !== 'mock' && !config.provider.apiKey) {
    throw new Error(`Chave do provedor ausente. Defina ${preset.keyEnv} (ou AI_API_KEY) no ambiente do servidor.`);
  }
}
