import type { Page } from 'playwright';
import sharp from 'sharp';
import { browser } from '../browser';
import { DEFAULT_FREE_SITES } from './site-list';
import { log } from '../bus';
import { paths } from '../paths';
import type { Settings } from '../settings';
import { RateLimitError, errorMessage, readJson, sleep, throwIfAborted, writeJson } from '../util';
import {
  CHALLENGE_TEXT,
  LIMIT_TEXT,
  bodyText,
  dismissOverlays,
  downloadImage,
  fillPrompt,
  findGenerateButton,
  findPromptInput,
  imageSources,
  largeImages,
  clickRobust,
  newLines,
  pageSignature,
  preloadLazyImages,
  settle,
  tryDownloadButton,
  trySelectAspect,
  unwrapResizedUrl,
  waitForChallenge,
} from './web-helpers';


export interface SiteState {
  ok: number;
  fail: number;
  consecutiveFail: number;
  pausedUntil?: string;
  pauseReason?: string;
  lastError?: string;
  lastOkAt?: string;
  lastTryAt?: string;
}

type States = Record<string, SiteState>;

/** Erro de um site que não deve ser tentado de novo por um tempo (limite, pede login, bloqueio). */
class SitePause extends Error {
  constructor(
    message: string,
    public hours: number,
  ) {
    super(message);
    this.name = 'SitePause';
  }
}

const LOGIN_WALL = /(sign in|log in|login|sign up|create (an )?account|entrar|fazer login|cadastr|inicia sesión|regístrate|登录|注册|ログイン|войти)/i;

export async function loadSiteStates(): Promise<States> {
  return readJson<States>(paths.siteStates, {});
}

export async function resetSiteStates(): Promise<void> {
  await writeJson(paths.siteStates, {});
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** Ordem de uso: sites disponíveis, os que mais funcionam primeiro, e rodízio entre eles. */
function orderSites(urls: string[], states: States): string[] {
  const now = Date.now();
  return urls
    .filter((u) => {
      const s = states[u];
      return !s?.pausedUntil || Date.parse(s.pausedUntil) <= now;
    })
    .sort((a, b) => {
      const sa = states[a] ?? { ok: 0, fail: 0, consecutiveFail: 0 };
      const sb = states[b] ?? { ok: 0, fail: 0, consecutiveFail: 0 };
      if (sa.consecutiveFail !== sb.consecutiveFail) return sa.consecutiveFail - sb.consecutiveFail;
      return Date.parse(sa.lastTryAt ?? '1970-01-01') - Date.parse(sb.lastTryAt ?? '1970-01-01');
    });
}

function siteSelectors(settings: Settings, url: string) {
  const host = hostOf(url);
  const o = settings.selectorOverrides;
  return {
    prompt: o[`site.${host}.prompt`] || o['site.prompt'],
    generate: o[`site.${host}.generate`] || o['site.generate'],
    image: o[`site.${host}.image`] || o['site.image'],
  };
}

const RATIO_TEXT: Record<string, string> = {
  '3:2': 'Landscape 3:2 aspect ratio.',
  '2:3': 'Portrait 2:3 aspect ratio.',
  '16:9': 'Wide landscape 16:9 aspect ratio.',
  '1:1': 'Square 1:1 aspect ratio.',
  '4:3': 'Landscape 4:3 aspect ratio.',
};

/** Melhor versão da imagem: botão "Download" do site → endereço original por trás da miniatura → a própria imagem. */
async function bestQuality(page: Page, src: string, signal: AbortSignal): Promise<{ buffer: Buffer; w: number; h: number; via: string }> {
  const options: { buffer: Buffer; via: string }[] = [];
  const fromButton = await tryDownloadButton(page, signal).catch(() => null);
  if (fromButton) options.push({ buffer: fromButton, via: 'botão download' });
  for (const candidate of unwrapResizedUrl(src, page.url())) {
    const buf = await downloadImage(page, candidate).catch(() => null);
    if (buf) options.push({ buffer: buf, via: 'original sem redimensionar' });
  }
  const shown = await downloadImage(page, src).catch(() => null);
  if (shown) options.push({ buffer: shown, via: 'imagem da página' });

  let best: { buffer: Buffer; w: number; h: number; via: string } | null = null;
  for (const o of options) {
    const meta = await sharp(o.buffer).metadata().catch(() => null);
    if (!meta?.width || !meta.height) continue;
    if (!best || meta.width * meta.height > best.w * best.h) best = { buffer: o.buffer, w: meta.width, h: meta.height, via: o.via };
  }
  if (!best) throw new Error('não consegui baixar a imagem gerada');
  return best;
}

/** Gera uma imagem em um site específico. */
async function generateOnSite(url: string, prompt: string, settings: Settings, signal: AbortSignal): Promise<Buffer> {
  const page = await browser.page(settings, 'gpt-image-2');
  try {
    return await runSite(page, url, prompt, settings, signal);
  } catch (err) {
    if (err instanceof Error && err.name !== 'StopError' && !signal.aborted) {
      const shot = await browser.screenshot(page, `site-${hostOf(url)}`);
      if (shot) err.message += ` (captura: ${shot})`;
    }
    throw err;
  }
}

async function runSite(page: Page, url: string, prompt: string, settings: Settings, signal: AbortSignal): Promise<Buffer> {
  const sel = siteSelectors(settings, url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await settle(page, 2000, signal);
  if (!(await waitForChallenge(page, signal))) throw new SitePause('verificação "sou humano" não liberou', 6);
  await dismissOverlays(page);

  const input = await findPromptInput(page, sel.prompt);
  if (!input) throw new Error('campo de prompt não encontrado (ajuste "site.prompt" nos seletores avançados)');
  await trySelectAspect(page, settings.aspectRatio);
  await preloadLazyImages(page, signal);
  const before = await imageSources(page);
  const textBefore = await bodyText(page);

  const fullPrompt = `${prompt} ${RATIO_TEXT[settings.aspectRatio] ?? ''}`.slice(0, 950);
  await fillPrompt(page, input, fullPrompt);
  await dismissOverlays(page);
  const signatureBefore = await pageSignature(page);
  const button = await findGenerateButton(page, input, sel.generate);
  if (!button || !(await clickRobust(button))) await input.press('Enter').catch(() => undefined);

  const start = Date.now();
  const deadline = start + settings.siteTimeoutMin * 60_000;
  let reacted = false;
  let nudged = false;
  let lastSrc = '';
  let stable = 0;
  await sleep(4000, signal);
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    const text = await bodyText(page);
    const fresh = newLines(textBefore, text);
    if (LIMIT_TEXT.test(fresh)) throw new SitePause(`limite gratuito atingido: "${fresh.match(LIMIT_TEXT)?.[0]}"`, settings.siteCooldownHours);
    if (CHALLENGE_TEXT.test(fresh) && !(await waitForChallenge(page, signal))) throw new SitePause('verificação "sou humano" apareceu', 6);
    const dialog = page.getByRole('dialog').last();
    if ((await dialog.isVisible().catch(() => false)) && LOGIN_WALL.test((await dialog.innerText().catch(() => '')).slice(0, 500))) {
      throw new SitePause('o site passou a pedir login/cadastro', 24 * 7);
    }

    // O site reagiu ao clique? Sem nenhuma mudança em 60 s, desiste e passa para o próximo.
    if (!reacted) {
      reacted = (await pageSignature(page)) !== signatureBefore;
      const idle = Date.now() - start;
      if (!reacted && idle > 15_000 && !nudged) {
        nudged = true;
        await input.press('Enter').catch(() => undefined);
      }
      if (!reacted && idle > 60_000) throw new Error('o site não reagiu ao botão de gerar em 60 s');
    }

    const imgs = (await largeImages(page, sel.image)).filter((i) => i.complete && !before.has(i.src));
    const shown = imgs.sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (shown) {
      stable = shown.src === lastSrc ? stable + 1 : 0;
      lastSrc = shown.src;
      if (stable >= 2) {
        const best = await bestQuality(page, shown.src, signal);
        if (Math.max(best.w, best.h) < settings.minSourceLongSide) {
          throw new SitePause(`entrega imagem pequena demais (${best.w}×${best.h}; mínimo ${settings.minSourceLongSide}px)`, 24);
        }
        if (best.via !== 'imagem da página') log.info(`${hostOf(url)}: imagem em resolução máxima via ${best.via} (${best.w}×${best.h}).`);
        return best.buffer;
      }
    }
    await sleep(2500, signal);
  }
  throw new Error(`nenhuma imagem nova em ${settings.siteTimeoutMin} min`);
}

/**
 * GPT Image 2 sem login: tenta os sites da lista em rodízio. Quando todos estão no limite,
 * avisa quanto tempo falta para o primeiro liberar (o motor envia o que já está pronto e espera).
 */
export async function generateWithFreeSites(prompt: string, settings: Settings, signal: AbortSignal): Promise<{ buffer: Buffer; source: string }> {
  const urls = settings.freeSites.length ? settings.freeSites : DEFAULT_FREE_SITES;
  const states = await loadSiteStates();
  const order = orderSites(urls, states);

  for (const url of order) {
    throwIfAborted(signal);
    const host = hostOf(url);
    const state: SiteState = (states[url] ??= { ok: 0, fail: 0, consecutiveFail: 0 });
    state.lastTryAt = new Date().toISOString();
    log.info(`GPT Image 2 via ${host}…`);
    try {
      const buffer = await generateOnSite(url, prompt, settings, signal);
      state.ok++;
      state.consecutiveFail = 0;
      state.lastOkAt = new Date().toISOString();
      state.lastError = undefined;
      await writeJson(paths.siteStates, states);
      return { buffer, source: `GPT Image 2 · ${host}` };
    } catch (err) {
      if (err instanceof Error && err.name === 'StopError') throw err;
      if (signal.aborted) throw err;
      state.fail++;
      state.lastError = errorMessage(err).split('\n')[0].slice(0, 240);
      if (err instanceof SitePause) {
        state.pausedUntil = new Date(Date.now() + err.hours * 3_600_000).toISOString();
        state.pauseReason = err.message;
        log.warn(`${host}: ${err.message}. Pausado por ${err.hours} h; passando para o próximo site.`);
      } else {
        state.consecutiveFail++;
        if (state.consecutiveFail >= 3) {
          state.pausedUntil = new Date(Date.now() + 2 * 3_600_000).toISOString();
          state.pauseReason = '3 falhas seguidas';
        }
        log.warn(`${host}: ${state.lastError}. Tentando o próximo site.`);
      }
      await writeJson(paths.siteStates, states);
    }
  }

  const next = urls
    .map((u) => states[u]?.pausedUntil)
    .filter((d): d is string => !!d)
    .map((d) => Date.parse(d))
    .filter((t) => t > Date.now())
    .sort((a, b) => a - b)[0];
  const minutes = next ? Math.ceil((next - Date.now()) / 60_000) + 1 : settings.rateLimitCooldownMin;
  throw new RateLimitError(`Todos os sites gratuitos de GPT Image 2 estão no limite ou indisponíveis agora`, minutes);
}
