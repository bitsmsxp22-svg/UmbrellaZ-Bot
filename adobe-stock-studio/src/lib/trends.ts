import { classifyCategory } from './categories';

export interface ResearchItem {
  /** Posição na busca do Adobe Stock ordenada por "mais baixadas". */
  rank: number;
  id: string;
  title: string;
  url: string;
  keywords: string[];
}

export interface Term {
  term: string;
  score: number;
}

export interface NicheResearch {
  query: string;
  category: number;
  seasonal: boolean;
  seasonalLabel?: string;
  totalResults: number | null;
  items: ResearchItem[];
  terms: Term[];
  source: 'adobe' | 'cache' | 'builtin';
  fetchedAt: string;
}

export interface Concept {
  niche: string;
  title: string;
  rank: number;
  score: number;
}

export interface ResearchSnapshot {
  generatedAt: string;
  nicheKey: string;
  niches: NicheResearch[];
  topTerms: Term[];
  topConcepts: Concept[];
}

const STOPWORDS = new Set(
  (
    'a an the and or of in on at to for with from by as is are be it its this that these those into over under ' +
    'up down out off about above below near next behind between during while without within vs via than then ' +
    'very more most much many some any each other another such only own same so too can will just new old ' +
    'one two three four five 3d 4k 8k hd copy space copyspace concept background image images photo photos ' +
    'picture stock illustration vector generative ai-generated generated generate isolated view top side front ' +
    'e o os as um uma de do da dos das em no na nos nas para por com sem sobre entre ao aos à às'
  ).split(/\s+/),
);

// Palavras genéricas de stock ("copy space", "background", "concept"...) ficam fora do ranking de termos:
// o gerador de prompts já as adiciona de forma explícita quando fazem sentido.

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((t) => t.length > 2 && !/^\d+$/.test(t));
}

/** Palavras de conteúdo (sem stopwords) — usadas para palavras-chave. */
export function contentTokens(text: string): string[] {
  return tokenize(text).filter((t) => !STOPWORDS.has(t));
}

/** Peso da posição no ranking de downloads (1º lugar vale mais). */
export const rankWeight = (rank: number): number => 1 / Math.log2(rank + 1);

export function computeTerms(items: ResearchItem[], limit = 30): Term[] {
  const scores = new Map<string, number>();
  const hits = new Map<string, number>();
  const add = (term: string, w: number) => {
    scores.set(term, (scores.get(term) ?? 0) + w);
    hits.set(term, (hits.get(term) ?? 0) + 1);
  };

  for (const item of items) {
    const w = rankWeight(item.rank);
    const tokens = tokenize(item.title);
    const seen = new Set<string>();
    tokens.forEach((tok, i) => {
      if (!STOPWORDS.has(tok) && !seen.has(tok)) {
        seen.add(tok);
        add(tok, w);
      }
      const next = tokens[i + 1];
      if (next && !STOPWORDS.has(tok) && !STOPWORDS.has(next)) add(`${tok} ${next}`, w * 0.8);
    });
    for (const kw of item.keywords) {
      const k = kw.toLowerCase().trim();
      if (k && !STOPWORDS.has(k) && !seen.has(k)) add(k, w * 0.6);
    }
  }

  // Expressões de duas palavras só contam quando aparecem em pelo menos 2 títulos diferentes.
  const sorted = [...scores.entries()]
    .filter(([term]) => !term.includes(' ') || (hits.get(term) ?? 0) >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
  const max = sorted[0]?.[1] ?? 1;
  return sorted.map(([term, score]) => ({ term, score: Math.round((score / max) * 100) }));
}

export function cleanTitle(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/\b(stock photo|royalty free|generative ai|ai generated)\b/gi, '')
    .replace(/\s*[|–—-]\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function makeNiche(
  query: string,
  items: ResearchItem[],
  source: NicheResearch['source'],
  extra: Partial<NicheResearch> = {},
): NicheResearch {
  const terms = computeTerms(items);
  return {
    query,
    category: classifyCategory(`${query} ${terms.slice(0, 10).map((t) => t.term).join(' ')}`),
    seasonal: false,
    totalResults: null,
    items,
    terms,
    source,
    fetchedAt: new Date().toISOString(),
    ...extra,
  };
}

export function buildSnapshot(niches: NicheResearch[], nicheKey: string): ResearchSnapshot {
  const global = new Map<string, number>();
  for (const n of niches) for (const t of n.terms) global.set(t.term, (global.get(t.term) ?? 0) + t.score);
  const topTerms = [...global.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([term, score]) => ({ term, score: Math.round(score) }));

  const topConcepts: Concept[] = niches
    .flatMap((n) =>
      n.items.slice(0, 5).map((it) => ({
        niche: n.query,
        title: it.title,
        rank: it.rank,
        score: Math.round(rankWeight(it.rank) * 100 * (n.seasonal ? 1.2 : 1)),
      })),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);

  return { generatedAt: new Date().toISOString(), nicheKey, niches, topTerms, topConcepts };
}
