import { chromium, type BrowserContext, type Page } from 'playwright';
import { log } from './bus';
import { ensureDir, paths } from './paths';
import type { Settings } from './settings';

type Globals = typeof globalThis & { __stockStudioBrowser?: BrowserManager };

/**
 * Um único navegador com perfil persistente (data/browser-profile). O login no ChatGPT e no
 * Adobe Stock é feito uma vez, manualmente, e fica salvo nesse perfil — o sistema não usa
 * chaves de API nem guarda senhas.
 */
class BrowserManager {
  private context: BrowserContext | null = null;
  private launching: Promise<BrowserContext> | null = null;
  private pages = new Map<string, Page>();

  isOpen(): boolean {
    return this.context !== null;
  }

  async getContext(settings: Settings): Promise<BrowserContext> {
    if (this.context) return this.context;
    this.launching ??= this.launch(settings).finally(() => {
      this.launching = null;
    });
    return this.launching;
  }

  private async launch(settings: Settings): Promise<BrowserContext> {
    ensureDir(paths.browserProfile);
    const base = {
      headless: settings.headless,
      viewport: null,
      acceptDownloads: true,
      locale: 'en-US',
      args: ['--disable-blink-features=AutomationControlled', '--start-maximized', '--no-default-browser-check'],
      ignoreDefaultArgs: ['--enable-automation'],
    };
    const executablePath = settings.browserExecutablePath || undefined;
    const channel = (executablePath || settings.browserChannel === 'chromium') ? undefined : settings.browserChannel;
    let ctx: BrowserContext;
    try {
      ctx = await chromium.launchPersistentContext(paths.browserProfile, { ...base, channel, executablePath });
    } catch (err) {
      if (!channel && !executablePath) throw err;
      log.warn(`Não consegui abrir o ${executablePath ?? channel} (${String(err).split('\n')[0]}). Usando o Chromium do Playwright.`);
      ctx = await chromium.launchPersistentContext(paths.browserProfile, base);
    }
    ctx.setDefaultTimeout(30_000);
    ctx.on('close', () => {
      this.context = null;
      this.pages.clear();
    });
    this.context = ctx;
    log.info('Navegador de automação aberto (perfil salvo em data/browser-profile).');
    return ctx;
  }

  /** Página nomeada e reaproveitável ("chatgpt", "adobe", "pesquisa"...). */
  async page(settings: Settings, name: string): Promise<Page> {
    const existing = this.pages.get(name);
    if (existing && !existing.isClosed()) return existing;
    const ctx = await this.getContext(settings);
    const blank = ctx.pages().find((p) => p.url() === 'about:blank' && ![...this.pages.values()].includes(p));
    const page = blank ?? (await ctx.newPage());
    this.pages.set(name, page);
    page.on('close', () => this.pages.delete(name));
    return page;
  }

  /**
   * Abre o navegador do sistema: portal do colaborador do Adobe Stock (o único login necessário,
   * para enviar as imagens para a SUA conta), ChatGPT sem conta e o primeiro site de GPT Image 2 —
   * assim você pode aceitar avisos de cookies/termos desses sites uma vez, se aparecerem.
   */
  async openLoginPages(settings: Settings): Promise<void> {
    const adobe = await this.page(settings, 'adobe');
    await adobe
      .goto(new URL('uploads', settings.adobeContributorUrl).toString(), { waitUntil: 'domcontentloaded' })
      .catch(() => undefined);
    const chat = await this.page(settings, 'chatgpt');
    await chat.goto(settings.chatgptUrl, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    if (settings.freeSites[0]) {
      const site = await this.page(settings, 'gpt-image-2');
      await site.goto(settings.freeSites[0], { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    }
    await adobe.bringToFront().catch(() => undefined);
  }

  async screenshot(page: Page, label: string): Promise<string | null> {
    try {
      ensureDir(paths.screenshots);
      const file = `${paths.screenshots}/${Date.now()}-${label.replace(/[^a-z0-9-]/gi, '_')}.png`;
      await page.screenshot({ path: file, fullPage: false });
      return file;
    } catch {
      return null;
    }
  }

  async close(): Promise<void> {
    const ctx = this.context;
    this.context = null;
    this.pages.clear();
    if (ctx) await ctx.close().catch(() => undefined);
  }
}

const g = globalThis as Globals;
export const browser: BrowserManager = (g.__stockStudioBrowser ??= new BrowserManager());
