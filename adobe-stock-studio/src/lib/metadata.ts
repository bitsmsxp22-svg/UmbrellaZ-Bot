import { classifyCategory } from './categories';

/** Marcas, personagens e ferramentas que não podem aparecer em prompts/metadados do Adobe Stock. */
const BLOCKED_TERMS = [
  'apple', 'iphone', 'ipad', 'macbook', 'samsung', 'google', 'android', 'microsoft', 'windows',
  'nike', 'adidas', 'puma', 'coca-cola', 'coca cola', 'pepsi', 'mcdonald', 'mcdonalds', 'starbucks',
  'disney', 'marvel', 'pixar', 'lego', 'barbie', 'tesla', 'bmw', 'mercedes', 'audi', 'ferrari',
  'porsche', 'toyota', 'facebook', 'instagram', 'whatsapp', 'tiktok', 'youtube', 'twitter', 'amazon',
  'netflix', 'chatgpt', 'openai', 'midjourney', 'stable diffusion', 'dall-e', 'dalle', 'firefly',
  'pokemon', 'star wars', 'harry potter', 'batman', 'superman', 'spiderman', 'spider-man', 'mickey',
  'hello kitty', 'nintendo', 'playstation', 'xbox', 'louis vuitton', 'gucci', 'rolex',
];

/** Termos que não descrevem a imagem e só poluem as palavras-chave. */
const NOISE_KEYWORDS = new Set([
  'ai generated', 'ai-generated', 'generative ai', 'generative', 'generated', 'stock', 'stock photo',
  'photo', 'image', 'picture', 'jpg', 'jpeg', 'hd', '4k', '8k', 'photorealistic', 'render',
]);

const blockedRegex = new RegExp(
  `\\b(${BLOCKED_TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('|')})\\b`,
  'gi',
);

export function removeBlockedTerms(text: string): string {
  return text.replace(blockedRegex, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
}

/** Regras do Adobe para o título: até 70 caracteres, sem vírgulas, sem "generative AI". */
export const TITLE_MAX = 70;

export function sanitizeTitle(title: string): string {
  let t = removeBlockedTerms(String(title ?? ''))
    .replace(/["“”]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\b(ai[- ]generated|generative ai|stock photo)\b/gi, '')
    .replace(/\s*[,;]\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s.:-]+|[\s:-]+$/g, '')
    .trim();
  if (t.length > TITLE_MAX) t = t.slice(0, TITLE_MAX + 1).replace(/\s+\S*$/, '').replace(/\s+(with|and|of|in|on|at|for|the|a|an)$/i, '');
  return t ? t[0].toUpperCase() + t.slice(1) : 'Stock image';
}

/** O Adobe aceita até 50 palavras-chave; usamos no máximo 49 por segurança. */
export function sanitizeKeywords(keywords: unknown, max = 49): string[] {
  const list = Array.isArray(keywords)
    ? keywords
    : typeof keywords === 'string'
      ? keywords.split(/[,;\n]/)
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const kw = removeBlockedTerms(String(raw ?? ''))
      .toLowerCase()
      .replace(/["“”#]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!kw || kw.length < 2 || kw.length > 50) continue;
    if (NOISE_KEYWORDS.has(kw) || /^\d+$/.test(kw)) continue;
    if (seen.has(kw)) continue;
    seen.add(kw);
    out.push(kw);
    if (out.length >= max) break;
  }
  return out;
}

export function sanitizePrompt(prompt: string): string {
  return removeBlockedTerms(String(prompt ?? '').replace(/[\r\n]+/g, ' ')).slice(0, 1500).trim();
}

export function normalizeCategory(value: unknown, context: string, fallback = 8): number {
  const n = Number(value);
  if (Number.isInteger(n) && n >= 1 && n <= 21) return n;
  return classifyCategory(context, fallback);
}
