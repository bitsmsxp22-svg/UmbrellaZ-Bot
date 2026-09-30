import type { Locator, Page } from 'playwright';
import { sleep, throwIfAborted } from '../util';

/**
 * Heurísticas genéricas para automatizar sites de IA sem código específico para cada um:
 * achar o campo de texto, o botão de gerar, fechar banners, detectar imagens novas e baixá-las.
 * Todas aceitam um seletor manual (Configurações → Seletores avançados) que tem prioridade.
 *
 * Importante: nenhum trecho de código passado para page.evaluate usa funções nomeadas
 * (o código é serializado e roda dentro da página).
 */

export const LIMIT_TEXT =
  /(daily limit|limit reached|reached (the|your) limit|out of credits|no credits|not enough credits|quota|upgrade to (continue|generate)|sign ?up to (continue|generate|get more)|log ?in to (continue|generate)|try again tomorrow|come back tomorrow|limite (diário|de uso|atingido)|sem créditos|créditos insuficientes|volte amanhã|faça login para continuar|cadastre-se para continuar|límite diario|sin créditos|每日.{0,6}(限制|上限)|额度已用完|次数已用完)/i;

export const CHALLENGE_TEXT = /(verify you are human|checking your browser|just a moment|confirme que você é humano|verificando seu navegador|cf-challenge|attention required)/i;

const GENERATE_TEXT = /^\s*(generate|generate image|create|create image|gerar|gerar imagem|criar|criar imagem|generar|generar imagen|crear|imagine|draw|run|make( it)?|生成|生成图片|作成|сгенерировать|создать)\b/i;
const DISMISS_TEXT = /^\s*(accept( all)?|agree|i agree|allow( all)?|got it|ok|okay|aceitar( todos)?|concordo|entendi|aceptar|zustimmen|close|fechar|cerrar|×|✕)\s*$/i;

export async function isVisible(loc: Locator): Promise<boolean> {
  return loc.isVisible().catch(() => false);
}

export async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
}

/** Espera a página "assentar" (rede ociosa ou tempo máximo). */
export async function settle(page: Page, ms = 2500, signal?: AbortSignal): Promise<void> {
  await Promise.race([page.waitForLoadState('networkidle').catch(() => undefined), sleep(ms * 3, signal)]);
  await sleep(ms, signal);
}

/** Fecha banners de cookies/avisos simples (não aceita termos de uso de contas). */
export async function dismissOverlays(page: Page): Promise<void> {
  for (let round = 0; round < 2; round++) {
    const buttons = page.getByRole('button', { name: DISMISS_TEXT });
    const count = Math.min(await buttons.count().catch(() => 0), 4);
    let clicked = false;
    for (let i = 0; i < count; i++) {
      const b = buttons.nth(i);
      if (await isVisible(b)) {
        await b.click({ timeout: 2000 }).catch(() => undefined);
        clicked = true;
      }
    }
    if (!clicked) break;
    await page.waitForTimeout(600);
  }
}

/** Se aparecer uma verificação "sou humano", espera ela se resolver sozinha (não tenta burlar). */
export async function waitForChallenge(page: Page, signal: AbortSignal, maxMs = 45_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const title = await page.title().catch(() => '');
    const text = (await bodyText(page)).slice(0, 2000);
    if (!CHALLENGE_TEXT.test(title) && !CHALLENGE_TEXT.test(text)) return true;
    throwIfAborted(signal);
    await sleep(2000, signal);
  }
  return false;
}

/** Campo onde se escreve o prompt: seletor manual → maior textarea visível → contenteditable → input de texto. */
export async function findPromptInput(page: Page, override?: string): Promise<Locator | null> {
  if (override) {
    const loc = page.locator(override).first();
    return (await isVisible(loc)) ? loc : null;
  }
  const index = await page.evaluate(() => {
    const cands = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"], input:not([type])'));
    let best = -1;
    let bestScore = 0;
    cands.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (r.width < 120 || r.height < 18 || st.visibility === 'hidden' || st.display === 'none') return;
      if ((el as HTMLInputElement).disabled || (el as HTMLInputElement).readOnly) return;
      const hint = `${el.getAttribute('placeholder') ?? ''} ${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('name') ?? ''} ${el.id}`.toLowerCase();
      if (/search|pesquis|buscar|email|e-mail|password|senha|newsletter/.test(hint)) return;
      let score = r.width * Math.min(r.height, 200);
      if (el.tagName === 'TEXTAREA') score *= 2;
      if (/prompt|describe|descreva|descri|imagine|idea|ideia|imagen|image|图片|描述/.test(hint)) score *= 3;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    return best;
  });
  if (index < 0) return null;
  return page.locator('textarea, [contenteditable="true"], input[type="text"], input:not([type])').nth(index);
}

export async function fillPrompt(page: Page, input: Locator, text: string): Promise<void> {
  await input.click();
  const editable = await input.evaluate((el) => el.getAttribute('contenteditable') === 'true').catch(() => false);
  if (editable) {
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(text);
  } else {
    await input.fill(text);
  }
}

/** Botão de gerar: seletor manual → botão com texto "Generate/Gerar/Create…" mais próximo do campo. */
export async function findGenerateButton(page: Page, input: Locator | null, override?: string): Promise<Locator | null> {
  if (override) {
    const loc = page.locator(override).first();
    return (await isVisible(loc)) ? loc : null;
  }
  const candidates = page.locator('button, [role="button"], input[type="submit"], a').filter({ hasText: GENERATE_TEXT });
  const count = Math.min(await candidates.count().catch(() => 0), 15);
  const box = input ? await input.boundingBox().catch(() => null) : null;
  let best: { loc: Locator; dist: number } | null = null;
  for (let i = 0; i < count; i++) {
    const loc = candidates.nth(i);
    if (!(await isVisible(loc)) || !(await loc.isEnabled().catch(() => false))) continue;
    const b = await loc.boundingBox().catch(() => null);
    if (!b) continue;
    const dist = box ? Math.hypot(b.x - box.x, b.y - (box.y + box.height)) : b.y;
    if (!best || dist < best.dist) best = { loc, dist };
  }
  if (best) return best.loc;
  const submit = page.locator('button[type="submit"]').first();
  return (await isVisible(submit)) ? submit : null;
}

/** Tenta escolher o formato (ex.: botão "3:2" ou "16:9"); se o site não tiver, ignora. */
export async function trySelectAspect(page: Page, ratio: string): Promise<boolean> {
  const loc = page.getByText(new RegExp(`^\\s*${ratio.replace(':', '\\s*:\\s*')}\\s*$`)).first();
  if (await isVisible(loc)) {
    await loc.click({ timeout: 2000 }).catch(() => undefined);
    return true;
  }
  return false;
}

export interface PageImage {
  src: string;
  w: number;
  h: number;
  complete: boolean;
}

/** Todas as fontes de imagem da página (inclui data-src de imagens preguiçosas). */
export async function imageSources(page: Page): Promise<Set<string>> {
  const list = await page
    .evaluate(() =>
      Array.from(document.querySelectorAll('img')).flatMap((img) =>
        [img.currentSrc, img.src, img.getAttribute('data-src'), img.getAttribute('data-lazy-src')].filter((s): s is string => !!s),
      ),
    )
    .catch(() => [] as string[]);
  return new Set(list);
}

/** Imagens grandes e carregadas; com seletor manual, procura só dentro dele. */
export async function largeImages(page: Page, scope?: string): Promise<PageImage[]> {
  return page
    .evaluate((sel) => {
      const roots = sel ? Array.from(document.querySelectorAll(sel)) : [document.body];
      const imgs = roots.flatMap((r) => (r.tagName === 'IMG' ? [r as HTMLImageElement] : Array.from(r.querySelectorAll('img'))));
      return imgs
        .filter((img) => img.naturalWidth >= 512 && img.naturalHeight >= 384)
        .map((img) => ({ src: img.currentSrc || img.src, w: img.naturalWidth, h: img.naturalHeight, complete: img.complete }));
    }, scope ?? null)
    .catch(() => [] as PageImage[]);
}

/** Rola a página até o fim e volta, para carregar imagens preguiçosas antes de "fotografar" o estado inicial. */
export async function preloadLazyImages(page: Page, signal: AbortSignal): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 3000).catch(() => undefined);
    await sleep(350, signal);
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
  await sleep(600, signal);
}

/**
 * Baixa a imagem pelo caminho que funcionar: requisição com os cookies do navegador →
 * fetch dentro da página (blob:/data:/mesma origem) → abrir a imagem numa aba.
 */
export async function downloadImage(page: Page, src: string): Promise<Buffer> {
  if (src.startsWith('data:')) return Buffer.from(src.split(',')[1] ?? '', 'base64');
  if (src.startsWith('http')) {
    try {
      const resp = await page.context().request.get(src, { timeout: 120_000, headers: { referer: page.url() } });
      if (resp.ok()) {
        const body = await resp.body();
        if (body.length > 10_000) return body;
      }
    } catch {
      /* tenta o próximo caminho */
    }
  }
  try {
    const b64 = await page.evaluate(async (url) => {
      const r = await fetch(url, { credentials: 'include' });
      const buf = new Uint8Array(await r.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(bin);
    }, src);
    const body = Buffer.from(b64, 'base64');
    if (body.length > 10_000) return body;
  } catch {
    /* tenta abrir numa aba */
  }
  if (!src.startsWith('http')) throw new Error('não consegui baixar a imagem gerada');
  const tab = await page.context().newPage();
  try {
    const resp = await tab.goto(src, { timeout: 60_000 });
    if (!resp?.ok()) throw new Error(`download da imagem falhou (HTTP ${resp?.status()})`);
    return await resp.body();
  } finally {
    await tab.close().catch(() => undefined);
  }
}

/** Linhas de texto que apareceram na página depois de um momento de referência. */
export function newLines(before: string, now: string): string {
  const seen = new Set(before.split('\n').map((l) => l.trim()));
  return now
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !seen.has(l))
    .join('\n');
}
