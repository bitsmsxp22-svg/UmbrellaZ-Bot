import { createHash } from 'node:crypto';
import { ADOBE_CATEGORIES } from './categories';
import type { ChatGPTWeb } from './chatgpt';
import { log } from './bus';
import { normalizeCategory, sanitizeKeywords, sanitizePrompt, sanitizeTitle } from './metadata';
import { paths } from './paths';
import type { Settings } from './settings';
import { contentTokens, rankWeight, type NicheResearch, type ResearchItem, type ResearchSnapshot } from './trends';
import { errorMessage, pick, readJson, weightedPick, writeJson } from './util';

/** Um conceito pronto para virar imagem: prompt + metadados do Adobe Stock. */
export interface ImageConcept {
  prompt: string;
  title: string;
  keywords: string[];
  category: number;
  niche: string;
  inspiration: string;
  inspirationRank: number;
  engine: 'chatgpt' | 'local';
}

interface Brief {
  niche: NicheResearch;
  reference: ResearchItem;
}

interface PromptMemory {
  nicheCursor: number;
  inspirations: Record<string, number>;
  hashes: string[];
}

/** Composição do prompt + como ela aparece no título e nas palavras-chave. */
const COMPOSITIONS = [
  { prompt: 'wide shot with generous empty copy space on the left side', title: 'with copy space', keywords: ['copy space'] },
  { prompt: 'composition with clean copy space on the right side', title: 'with copy space', keywords: ['copy space'] },
  { prompt: 'centered subject with negative space above for headlines', title: 'with space for text', keywords: ['copy space', 'text space'] },
  { prompt: 'rule of thirds composition with shallow depth of field', title: '', keywords: ['depth of field'] },
  { prompt: 'top-down flat lay composition with neatly arranged elements', title: 'flat lay top view', keywords: ['flat lay', 'top view'] },
  { prompt: 'close-up detail shot with creamy bokeh background', title: 'close-up', keywords: ['close-up', 'bokeh'] },
  { prompt: 'panoramic banner-friendly composition with open space for text', title: 'banner with copy space', keywords: ['banner', 'copy space', 'panoramic'] },
];
const LIGHTING = [
  'soft natural window light',
  'warm golden hour sunlight',
  'bright high-key studio lighting',
  'cinematic rim light with gentle contrast',
  'soft diffused daylight',
  'moody low-key lighting with deep shadows',
  'clean even commercial lighting',
];
const CAMERA = [
  'shot on a full-frame camera, 50mm lens, f/2.8',
  '85mm lens, f/1.8, beautiful background blur',
  '35mm lens, f/4, tack-sharp focus',
  'macro lens capturing fine textures',
  '24mm wide-angle lens, natural perspective',
];
const MOODS = [
  'optimistic and modern',
  'calm and trustworthy',
  'energetic and vibrant',
  'premium and elegant',
  'authentic and candid',
  'minimalist and clean',
];
const PALETTES = [
  'soft pastel color palette',
  'teal and warm orange tones',
  'neutral earthy tones',
  'vibrant saturated colors',
  'cool blue monochrome palette',
  'warm beige and white tones',
  'deep navy with subtle gold accents',
];
const IMPROVEMENTS = [
  'more authentic and natural than typical stock imagery',
  'naturally diverse and inclusive fictional people',
  'uncluttered, well-organized background',
  'realistic textures and accurate materials',
  'high dynamic range with crisp detail on the main subject',
];

const GRAPHIC_CATEGORY = 8;

function hash(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 16);
}

async function loadMemory(): Promise<PromptMemory> {
  return readJson<PromptMemory>(paths.usedPrompts, { nicheCursor: 0, inspirations: {}, hashes: [] });
}

async function saveMemory(mem: PromptMemory): Promise<void> {
  mem.hashes = mem.hashes.slice(-5000);
  await writeJson(paths.usedPrompts, mem);
}

/**
 * Distribui as imagens do lote entre os nichos (rodízio entre lotes; datas sazonais valem em dobro)
 * e escolhe, em cada nicho, uma referência entre as mais baixadas — quanto melhor o ranking,
 * maior a chance de ser escolhida. Referências já usadas 2 vezes são evitadas.
 */
function planBriefs(snapshot: ResearchSnapshot, count: number, mem: PromptMemory): Brief[] {
  // Todos os nichos entram uma vez (sazonais primeiro) e os sazonais ganham uma segunda vaga no fim da fila.
  const withItems = snapshot.niches.filter((n) => n.items.length > 0);
  const pool = [...withItems, ...withItems.filter((n) => n.seasonal)];
  if (pool.length === 0) return [];
  const briefs: Brief[] = [];
  for (let i = 0; i < count; i++) {
    const niche = pool[(mem.nicheCursor + i) % pool.length];
    const candidates = niche.items.slice(0, 15).filter((it) => (mem.inspirations[`${niche.query}#${it.id}`] ?? 0) < 2);
    const reference = weightedPick(candidates.length ? candidates : niche.items.slice(0, 15), (it) => rankWeight(it.rank));
    const key = `${niche.query}#${reference.id}`;
    mem.inspirations[key] = (mem.inspirations[key] ?? 0) + 1;
    briefs.push({ niche, reference });
  }
  mem.nicheCursor = (mem.nicheCursor + count) % Math.max(pool.length, 1);
  return briefs;
}

function subjectFrom(title: string): string {
  return title
    .replace(/\b(stock photo|photo|image|picture|illustration|vector|generative ai|ai generated)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.-]+|[\s,.-]+$/g, '')
    .trim();
}

/** Gerador local (sem IA): combina a referência do ranking com melhorias de composição/luz. */
function localConcept(brief: Brief, usedHashes: Set<string>): ImageConcept {
  const subject = subjectFrom(brief.reference.title) || brief.niche.query;
  const isGraphic = brief.niche.category === GRAPHIC_CATEGORY || /background|texture|pattern|abstract/i.test(subject);
  let prompt = '';
  let composition = COMPOSITIONS[0];
  let mood = '';
  for (let attempt = 0; attempt < 12; attempt++) {
    composition = pick(COMPOSITIONS);
    mood = pick(MOODS);
    const parts = isGraphic
      ? [
          `High-end ${subject.toLowerCase()}`,
          composition.prompt,
          pick(PALETTES),
          `${mood} feel`,
          'seamless smooth gradients and refined details',
          'ultra high resolution, perfect for web banners and presentations',
        ]
      : [
          `Photorealistic stock photo of ${subject.toLowerCase()}`,
          composition.prompt,
          pick(LIGHTING),
          `${mood} atmosphere`,
          pick(PALETTES),
          pick(CAMERA),
          pick(IMPROVEMENTS),
          'professional commercial photography, ultra detailed, true-to-life colors',
        ];
    prompt = `${parts.join(', ')}. No text, no letters, no logos, no watermarks, no brand names, no trademarks.`;
    if (!usedHashes.has(hash(prompt))) break;
  }

  // Título descritivo: o assunto da referência + o diferencial da composição nova.
  const suffix = composition.title && !subject.toLowerCase().includes(composition.title) ? `, ${composition.title}` : '';
  const title = sanitizeTitle(`${subject}${subject.length + suffix.length <= 80 ? suffix : ''}`);

  // Palavras-chave relevantes primeiro: assunto → palavras-chave da própria referência → núcleo do nicho.
  const nicheCore = brief.niche.terms.filter((t) => !t.term.includes(' ')).slice(0, 6).map((t) => t.term);
  const keywords = sanitizeKeywords([
    ...contentTokens(subject),
    ...brief.reference.keywords.slice(0, 25),
    ...contentTokens(brief.niche.query),
    ...nicheCore,
    ...composition.keywords,
    ...mood.split(' and '),
    ...(isGraphic ? ['background', 'design', 'wallpaper'] : []),
  ]);
  return {
    prompt: sanitizePrompt(prompt),
    title,
    keywords,
    // O nicho pesa em dobro na escolha da categoria.
    category: normalizeCategory(null, `${brief.niche.query} ${brief.niche.query} ${subject}`, brief.niche.category),
    niche: brief.niche.query,
    inspiration: brief.reference.title,
    inspirationRank: brief.reference.rank,
    engine: 'local',
  };
}

function chatgptInstruction(briefs: Brief[], settings: Settings): string {
  const categories = ADOBE_CATEGORIES.map((c) => `${c.id} ${c.name}`).join(', ');
  const lines = briefs.map((b, i) => {
    const others = b.niche.items
      .slice(0, 6)
      .filter((it) => it.id !== b.reference.id)
      .map((it) => `#${it.rank} "${it.title}"`)
      .join('; ');
    const terms = b.niche.terms.slice(0, 15).map((t) => t.term).join(', ');
    return (
      `${i + 1}. Niche: "${b.niche.query}"${b.niche.seasonal ? ' (seasonal — upcoming holiday demand)' : ''}\n` +
      `   Best-seller reference (#${b.reference.rank} by downloads): "${b.reference.title}"\n` +
      `   Other top sellers: ${others || 'n/a'}\n` +
      `   Trending keywords: ${terms || 'n/a'}`
    );
  });
  return [
    'You are a senior Adobe Stock art director and keyword specialist.',
    'Below are briefs built from the current Adobe Stock best-seller ranking (search sorted by number of downloads).',
    `For EACH brief create ONE original image concept that can outsell the reference. Do not copy the reference: improve composition, lighting, authenticity, copy space and usefulness for advertisers.`,
    '',
    ...lines,
    '',
    'Rules:',
    '- Photorealistic, except for backgrounds/textures which may be graphic.',
    '- Never include text, letters, logos, watermarks, brands, trademarks, real or famous people, artist names, copyrighted characters, or identifiable private property.',
    '- People must be fictional adults or families; show diversity naturally.',
    `- Image format: ${settings.aspectRatio}.`,
    '- "prompt": English, 60-120 words, very specific (subject, action, setting, composition with copy space, lighting, lens, color palette, mood).',
    '- "title": English, 5-12 words, natural descriptive sentence, max 70 characters, no keyword stuffing.',
    '- "keywords": 35-45 English keywords, single words or short phrases, most important first (the first 10 matter most), no brands, no "AI".',
    `- "category": Adobe Stock category number (${categories}).`,
    '',
    `Answer ONLY with a JSON array of ${briefs.length} objects, in the same order as the briefs:`,
    '[{"brief":1,"prompt":"...","title":"...","keywords":["..."],"category":3}]',
    'No explanations, no markdown.',
  ].join('\n');
}

export function extractJsonArray(text: string): unknown[] | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.indexOf('[');
    const end = c.lastIndexOf(']');
    if (start < 0 || end <= start) continue;
    try {
      const parsed = JSON.parse(c.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* tenta o próximo */
    }
  }
  return null;
}

async function chatgptConcepts(briefs: Brief[], settings: Settings, chat: ChatGPTWeb): Promise<(ImageConcept | null)[]> {
  const answer = await chat.ask(chatgptInstruction(briefs, settings));
  const arr = extractJsonArray(answer);
  if (!arr) throw new Error('resposta do ChatGPT não veio em JSON');
  return briefs.map((brief, i) => {
    const raw = (arr.find((o) => (o as { brief?: number })?.brief === i + 1) ?? arr[i]) as Record<string, unknown> | undefined;
    if (!raw || typeof raw.prompt !== 'string' || typeof raw.title !== 'string') return null;
    const keywords = sanitizeKeywords(raw.keywords);
    if (keywords.length < 10) return null;
    const title = sanitizeTitle(raw.title);
    return {
      prompt: sanitizePrompt(raw.prompt),
      title,
      keywords,
      category: normalizeCategory(raw.category, `${brief.niche.query} ${title} ${keywords.join(' ')}`, brief.niche.category),
      niche: brief.niche.query,
      inspiration: brief.reference.title,
      inspirationRank: brief.reference.rank,
      engine: 'chatgpt' as const,
    };
  });
}

/**
 * Desenvolve os prompts do lote com base no ranking das mais vendidas.
 * Com o motor "chatgpt", o próprio ChatGPT escreve prompt + título + palavras-chave; se falhar,
 * o gerador local assume para a produção não parar.
 */
export async function developConcepts(
  snapshot: ResearchSnapshot,
  count: number,
  settings: Settings,
  getChat: (() => Promise<ChatGPTWeb>) | null,
): Promise<ImageConcept[]> {
  const mem = await loadMemory();
  const usedHashes = new Set(mem.hashes);
  const briefs = planBriefs(snapshot, count, mem);
  let concepts: (ImageConcept | null)[] = briefs.map(() => null);

  if (settings.promptEngine === 'chatgpt' && getChat && briefs.length) {
    try {
      log.info(`Pedindo ao ChatGPT ${briefs.length} prompts com base no ranking das mais vendidas…`);
      concepts = await chatgptConcepts(briefs, settings, await getChat());
      const ok = concepts.filter(Boolean).length;
      log.success(`ChatGPT criou ${ok} de ${briefs.length} prompts.`);
    } catch (err) {
      if (err instanceof Error && ['StopError', 'NeedsLoginError', 'RateLimitError'].includes(err.name)) throw err;
      log.warn(`Não consegui usar o ChatGPT para os prompts (${errorMessage(err)}). Usando o gerador local.`);
    }
  }

  const result = briefs.map((brief, i) => concepts[i] ?? localConcept(brief, usedHashes));
  for (const c of result) mem.hashes.push(hash(c.prompt));
  await saveMemory(mem);
  return result;
}
