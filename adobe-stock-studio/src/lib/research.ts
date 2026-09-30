import type { Page } from 'playwright';
import { browser } from './browser';
import { builtinNiche } from './builtin-research';
import { bus, log } from './bus';
import { paths } from './paths';
import { upcomingSeasonal } from './seasonal';
import { selectors } from './selectors';
import type { Settings } from './settings';
import { buildSnapshot, cleanTitle, makeNiche, type NicheResearch, type ResearchItem, type ResearchSnapshot } from './trends';
import { errorMessage, randomBetween, readJson, sleep, throwIfAborted, writeJson } from './util';

interface NicheTarget {
  query: string;
  seasonal: boolean;
  seasonalLabel?: string;
}

export function nicheTargets(settings: Settings, now = new Date()): NicheTarget[] {
  const base: NicheTarget[] = settings.niches.map((q) => ({ query: q, seasonal: false }));
  if (!settings.includeSeasonal) return base;
  const seasonal = upcomingSeasonal(now)
    .filter((ev) => !base.some((b) => b.query.toLowerCase() === ev.query))
    .map((ev) => ({ query: ev.query, seasonal: true, seasonalLabel: `${ev.name} (em ${ev.daysAhead} dias)` }));
  return [...seasonal, ...base];
}

const keyOf = (targets: NicheTarget[]) => targets.map((t) => t.query.toLowerCase()).join('|');

export async function loadResearch(): Promise<ResearchSnapshot | null> {
  return readJson<ResearchSnapshot | null>(paths.research, null);
}

export function searchUrl(query: string, settings: Settings): string {
  const url = new URL('https://stock.adobe.com/search');
  url.searchParams.set('k', query);
  url.searchParams.set('order', 'nb_downloads');
  url.searchParams.set('limit', String(Math.min(100, settings.researchResultsPerQuery)));
  url.searchParams.set('filters[content_type:photo]', '1');
  let out = url.toString();
  const extra = settings.researchExtraParams.trim().replace(/^[?&]+/, '');
  if (extra) out += `&${extra}`;
  return out;
}

function parseCount(raw: string | null): number | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

async function scrapeSearch(page: Page, query: string, settings: Settings, signal: AbortSignal) {
  const linkSel = selectors(settings.selectorOverrides)('adobe.searchResultLink');
  await page.goto(searchUrl(query, settings), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector(linkSel, { timeout: 30_000 }).catch(() => undefined);
  for (let i = 0; i < 6; i++) {
    throwIfAborted(signal);
    await page.mouse.wheel(0, 2500).catch(() => undefined);
    await sleep(600, signal);
  }
  const raw = await page.evaluate((sel) => {
    const out: { id: string; slug: string; alt: string; url: string }[] = [];
    const seen = new Set<string>();
    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>(sel))) {
      const m = a.href.match(/\/images\/([^/?#]+)\/(\d+)/);
      if (!m || seen.has(m[2])) continue;
      seen.add(m[2]);
      const img = a.querySelector('img');
      const alt = (img?.getAttribute('alt') || a.getAttribute('aria-label') || a.getAttribute('title') || '').trim();
      out.push({ id: m[2], slug: decodeURIComponent(m[1]), alt, url: a.href.split('?')[0] });
    }
    const text = document.body?.innerText ?? '';
    const total = text.match(/([\d][\d.,\s]{2,})\s+(results|resultados)/i);
    return { out, total: total ? total[1] : null, title: document.title };
  }, linkSel);

  if (raw.out.length === 0) {
    throw new Error(/denied|blocked|captcha|robot/i.test(raw.title) ? 'acesso bloqueado pelo Adobe Stock' : 'nenhum resultado encontrado na página');
  }
  const items: ResearchItem[] = raw.out.slice(0, settings.researchResultsPerQuery).map((r, i) => ({
    rank: i + 1,
    id: r.id,
    title: cleanTitle(r.alt && r.alt.length > 8 ? r.alt : r.slug.replace(/-/g, ' ')),
    url: r.url,
    keywords: [],
  }));
  return { items, totalResults: parseCount(raw.total) };
}

/** Abre as páginas das campeãs de download para ler as palavras-chave usadas por elas. */
async function readKeywords(page: Page, item: ResearchItem, signal: AbortSignal): Promise<void> {
  if (!item.url) return;
  throwIfAborted(signal);
  await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await sleep(1500, signal);
  // Sem funções nomeadas dentro do evaluate: o código roda serializado dentro da página.
  const data = await page.evaluate(() => {
    const heading = Array.from(document.querySelectorAll('h1,h2,h3,h4,span,div,p')).find((el) =>
      /^(keywords|related keywords|palavras-chave|palavras-chave relacionadas)$/i.test((el.textContent ?? '').replace(/\s+/g, ' ').trim()),
    );
    const scope = heading?.parentElement?.parentElement ?? document.body;
    const kws = Array.from(scope.querySelectorAll('a, button'))
      .filter((el) => /[?&]k=|keyword/i.test(el.getAttribute('href') ?? el.getAttribute('data-t') ?? ''))
      .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter((t) => t.length > 1 && t.length < 40 && !/(see all|ver tudo|search|pesquisar|mais)/i.test(t));
    const title = (document.querySelector('h1')?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return { title, keywords: Array.from(new Set(kws)).slice(0, 50) };
  });
  if (data.title && data.title.length > 8) item.title = cleanTitle(data.title);
  item.keywords = data.keywords;
}

/**
 * Pesquisa as imagens mais baixadas do Adobe Stock para cada nicho e monta o ranking de termos.
 * Usa cache (configurável em horas) e, se o site não responder, usa o último resultado salvo
 * ou os conceitos de reserva — a produção nunca fica parada por causa da pesquisa.
 */
export async function runResearch(settings: Settings, signal: AbortSignal, force = false): Promise<ResearchSnapshot> {
  const targets = nicheTargets(settings);
  const key = keyOf(targets);
  const cached = await loadResearch();
  const ageHours = cached ? (Date.now() - new Date(cached.generatedAt).getTime()) / 3_600_000 : Infinity;

  if (!force && cached && cached.nicheKey === key && ageHours < settings.researchRefreshHours) {
    log.info(`Usando pesquisa de ${Math.round(ageHours * 10) / 10} h atrás (${cached.niches.length} nichos).`);
    return cached;
  }

  const niches: NicheResearch[] = [];
  if (settings.simulationMode) {
    log.info('Modo simulação: usando conceitos de referência internos (sem acessar o Adobe Stock).');
    for (const t of targets) niches.push(builtinNiche(t.query, { seasonal: t.seasonal, seasonalLabel: t.seasonalLabel }));
  } else {
    const page = await browser.page(settings, 'pesquisa');
    for (const [i, t] of targets.entries()) {
      throwIfAborted(signal);
      bus.emit('research-progress', { index: i + 1, total: targets.length, query: t.query });
      log.info(`Pesquisando mais vendidas (${i + 1}/${targets.length}): "${t.query}"${t.seasonal ? ` — sazonal: ${t.seasonalLabel}` : ''}`);
      try {
        const { items, totalResults } = await scrapeSearch(page, t.query, settings, signal);
        for (const item of items.slice(0, settings.researchDeepItems)) {
          await readKeywords(page, item, signal).catch((e) => log.warn(`Palavras-chave de "${item.title}": ${errorMessage(e)}`));
          await sleep(randomBetween(800, 2000), signal);
        }
        niches.push(makeNiche(t.query, items, 'adobe', { seasonal: t.seasonal, seasonalLabel: t.seasonalLabel, totalResults }));
        log.success(`"${t.query}": ${items.length} campeãs de download analisadas${totalResults ? ` (${totalResults.toLocaleString('pt-BR')} resultados no total)` : ''}.`);
      } catch (err) {
        if (err instanceof Error && err.name === 'StopError') throw err;
        const old = cached?.niches.find((n) => n.query === t.query);
        log.warn(`Pesquisa de "${t.query}" falhou (${errorMessage(err)}). Usando ${old ? 'o último resultado salvo' : 'conceitos de reserva'}.`);
        niches.push(
          old ? { ...old, source: 'cache', seasonal: t.seasonal, seasonalLabel: t.seasonalLabel } : builtinNiche(t.query, { seasonal: t.seasonal, seasonalLabel: t.seasonalLabel }),
        );
      }
      await sleep(randomBetween(1500, 4000), signal);
    }
  }

  const snapshot = buildSnapshot(niches, key);
  await writeJson(paths.research, snapshot);
  bus.emit('research', snapshot);
  const top = snapshot.topTerms.slice(0, 8).map((t) => t.term).join(', ');
  log.success(`Ranking atualizado. Termos mais fortes: ${top}.`);
  return snapshot;
}
