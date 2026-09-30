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

const SMALL_WORDS = /^(with|and|of|in|on|at|for|the|a|an|to|by|from|or|as)$/i;

/** "Pumpkins On Rustic Table With Candles" → "Pumpkins on rustic table with candles" (siglas ficam). */
function sentenceCase(text: string): string {
  const words = text.split(' ');
  const long = words.filter((w) => w.length > 3);
  const capitalized = long.filter((w) => /^[A-Z][a-z]/.test(w)).length;
  if (long.length < 3 || capitalized / long.length < 0.6) return text;
  return words.map((w, i) => (i > 0 && /^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w)).join(' ');
}

export function sanitizeTitle(title: string): string {
  let t = removeBlockedTerms(String(title ?? ''))
    .replace(/["“”]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\b(ai[- ]generated|generative ai|stock photo)\b/gi, '')
    .replace(/\s+[-–—|]\s+/g, ' ')
    .replace(/\s*[,;]\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s.:-]+|[\s:-]+$/g, '')
    .trim();
  t = sentenceCase(t);
  if (t.length > TITLE_MAX) {
    const words = t.slice(0, TITLE_MAX + 1).split(' ');
    words.pop(); // palavra cortada no meio
    // Não termina em "… for black" / "… with": corta o pedaço solto depois da última preposição.
    const lastSmall = words.map((w) => SMALL_WORDS.test(w)).lastIndexOf(true);
    if (lastSmall > words.length / 2 && words.length - lastSmall <= 3) words.splice(lastSmall);
    while (words.length > 1 && SMALL_WORDS.test(words[words.length - 1])) words.pop();
    t = words.join(' ');
  }
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
