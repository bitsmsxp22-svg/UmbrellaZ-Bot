import type { Page } from 'playwright';
import { browser } from './browser';
import { downloadImage } from './providers/web-helpers';
import { log } from './bus';
import { selectors, type SelectorKey } from './selectors';
import type { AspectRatio, Settings } from './settings';
import { NeedsLoginError, RateLimitError, RefusedError, sleep, throwIfAborted } from './util';

interface TurnSnapshot {
  text: string;
  images: { src: string; w: number; h: number; complete: boolean }[];
}

const LIMIT_PATTERN =
  /(hit (the|your) .*limit|reached .*limit|usage limit|rate limit|limite de (uso|gera|imagens)|atingiu o limite|try again (later|in|after)|tente novamente (mais tarde|em|daqui)|too many requests|muitas solicita)/i;
const REFUSAL_PATTERN =
  /(can't (help|create|generate)|cannot (create|generate)|unable to (create|generate)|não (posso|consigo) (criar|gerar)|content polic|polític[ao] de conte|violat|viola)/i;
const STAY_LOGGED_OUT = /(stay logged out|continue (logged out|without (an )?account)|continuar (sem conta|desconectado)|permanecer desconectado|seguir sin (iniciar|cuenta))/i;
const BUSY_PATTERN = /(creating image|generating image|criando imagem|gerando imagem|getting started|starting image|preparing)/i;

const SIZE_HINT: Record<AspectRatio, string> = {
  '3:2': 'landscape orientation, 3:2 aspect ratio (1536x1024)',
  '2:3': 'portrait orientation, 2:3 aspect ratio (1024x1536)',
  '16:9': 'wide landscape orientation, 16:9 aspect ratio',
  '1:1': 'square 1:1 aspect ratio (1024x1024)',
  '4:3': 'landscape orientation, 4:3 aspect ratio',
};

/** Extrai "tente novamente em X minutos/horas" da mensagem de limite. */
function parseWaitMinutes(text: string): number | undefined {
  const hours = text.match(/(\d+)\s*(hours?|horas?|h)\b/i);
  const minutes = text.match(/(\d+)\s*(minutes?|minutos?|min)\b/i);
  let total = 0;
  if (hours) total += Number(hours[1]) * 60;
  if (minutes) total += Number(minutes[1]);
  return total > 0 ? total + 1 : undefined;
}

/**
 * Automação do ChatGPT pela interface web (sem API): usa a conta já logada no navegador
 * do sistema. As imagens são geradas pelo modelo de imagem do próprio ChatGPT (GPT Image).
 */
export class ChatGPTWeb {
  private sel: (key: SelectorKey) => string;

  private constructor(
    private page: Page,
    private settings: Settings,
    private signal: AbortSignal,
  ) {
    this.sel = selectors(settings.selectorOverrides);
  }

  static async open(settings: Settings, signal: AbortSignal): Promise<ChatGPTWeb> {
    const page = await browser.page(settings, 'chatgpt');
    return new ChatGPTWeb(page, settings, signal);
  }

  private chatUrl(): string {
    const url = new URL(this.settings.chatgptUrl);
    if (this.settings.useTemporaryChat) url.searchParams.set('temporary-chat', 'true');
    return url.toString();
  }

  /**
   * Abre uma conversa nova e espera a caixa de mensagem. Sem conta, o ChatGPT funciona para texto
   * (prompts): o convite de login é fechado com "Continuar desconectado". Para gerar imagens pelo
   * ChatGPT (opcional) é preciso estar logado.
   */
  async newChat(requireLogin: boolean): Promise<void> {
    throwIfAborted(this.signal);
    await this.page.goto(this.chatUrl(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      throwIfAborted(this.signal);
      await this.stayLoggedOut();
      if (await this.isVisible(this.sel('chatgpt.composer'))) return;
      if (requireLogin && (await this.isVisible(this.sel('chatgpt.loginButton')))) {
        await this.page.bringToFront().catch(() => undefined);
        throw new NeedsLoginError('chatgpt', 'Gerar imagens pelo ChatGPT exige login. Use a opção "Sites grátis de GPT Image 2 (sem login)" ou entre na conta pelo botão "Abrir navegador".');
      }
      await sleep(1000, this.signal);
    }
    const shot = await browser.screenshot(this.page, 'chatgpt-sem-caixa');
    const detail = `Não encontrei a caixa de mensagem do ChatGPT (verificação "sou humano" ou limite de uso sem conta).${shot ? ` Captura: ${shot}` : ''}`;
    if (requireLogin) throw new NeedsLoginError('chatgpt', detail);
    throw new Error(detail);
  }

  /** Fecha o convite "Entrar / Cadastrar" do ChatGPT sem conta. */
  private async stayLoggedOut(): Promise<void> {
    for (const role of ['link', 'button'] as const) {
      const loc = this.page.getByRole(role, { name: STAY_LOGGED_OUT }).first();
      if (await loc.isVisible().catch(() => false)) {
        await loc.click().catch(() => undefined);
        await sleep(800, this.signal);
        return;
      }
    }
  }

  /** O ChatGPT sem conta pede cadastro depois de algumas mensagens. */
  private async loginWallVisible(): Promise<boolean> {
    const dialog = this.page.getByRole('dialog').last();
    if (!(await dialog.isVisible().catch(() => false))) return false;
    const text = (await dialog.innerText().catch(() => '')).slice(0, 600);
    return /(log in|sign up|entrar|cadastr|create (a free )?account|crie uma conta)/i.test(text) && !STAY_LOGGED_OUT.test(text);
  }

  private async isVisible(selector: string): Promise<boolean> {
    try {
      return await this.page.locator(selector).first().isVisible({ timeout: 500 });
    } catch {
      return false;
    }
  }

  private async send(text: string): Promise<void> {
    const composer = this.page.locator(this.sel('chatgpt.composer')).first();
    await composer.click();
    await this.page.keyboard.press('ControlOrMeta+A');
    await this.page.keyboard.press('Backspace');
    await this.page.keyboard.insertText(text);
    await sleep(700, this.signal);
    const sendButton = this.page.locator(this.sel('chatgpt.sendButton')).first();
    if ((await sendButton.isVisible().catch(() => false)) && (await sendButton.isEnabled().catch(() => false))) {
      await sendButton.click();
    } else {
      await this.page.keyboard.press('Enter');
    }
  }

  /** Lê a última resposta do assistente: texto e imagens grandes (ignora avatares/ícones). */
  private async snapshot(): Promise<TurnSnapshot> {
    return this.page.evaluate(
      ({ turnSel, assistantSel, userSel }) => {
        const turns = Array.from(document.querySelectorAll(turnSel));
        const assistants = Array.from(document.querySelectorAll(assistantSel));
        const lastAssistant = assistants[assistants.length - 1] as HTMLElement | undefined;
        let container: Element | undefined = turns[turns.length - 1];
        if (!container && lastAssistant) container = lastAssistant.closest('article') ?? lastAssistant;
        if (!container) return { text: '', images: [] };
        const onlyUser = !!container.querySelector(userSel) && !container.querySelector(assistantSel);
        const imgs = Array.from(container.querySelectorAll('img'))
          .filter((img) => !img.closest(userSel) && img.naturalWidth >= 256 && img.naturalHeight >= 256)
          .map((img) => ({ src: img.currentSrc || img.src, w: img.naturalWidth, h: img.naturalHeight, complete: img.complete }));
        const unique = imgs.filter((img, i) => imgs.findIndex((o) => o.src === img.src) === i);
        if (onlyUser && unique.length === 0) return { text: '', images: [] };
        const text = (lastAssistant?.innerText ?? (container as HTMLElement).innerText ?? '').trim();
        return { text, images: unique };
      },
      {
        turnSel: this.sel('chatgpt.turn'),
        assistantSel: this.sel('chatgpt.assistantMessage'),
        userSel: this.sel('chatgpt.userMessage'),
      },
    );
  }

  private async waitForReply(timeoutMs: number, expectImage: boolean): Promise<TurnSnapshot> {
    const start = Date.now();
    let lastSignature = '';
    let stable = 0;
    await sleep(3000, this.signal);
    while (Date.now() - start < timeoutMs) {
      throwIfAborted(this.signal);
      await sleep(2500, this.signal);
      if (await this.isVisible(this.sel('chatgpt.stopButton'))) {
        stable = 0;
        continue;
      }
      if (await this.loginWallVisible()) throw new Error('o ChatGPT sem conta pediu login/cadastro para continuar');
      const snap = await this.snapshot().catch(() => ({ text: '', images: [] }) as TurnSnapshot);
      const signature = `${snap.text.length}|${snap.images.map((i) => `${i.src}:${i.w}:${i.complete}`).join(',')}`;
      stable = signature === lastSignature ? stable + 1 : 0;
      lastSignature = signature;

      const ready = snap.images.filter((i) => i.complete && i.w >= 512);
      if (expectImage) {
        const busy = BUSY_PATTERN.test(snap.text);
        // A imagem aparece de forma progressiva: só aceita quando parou de mudar por ~7 s.
        if (ready.length > 0 && !busy && stable >= 3) return { ...snap, images: ready };
        if (ready.length === 0 && snap.text && !busy && stable >= 6) return { ...snap, images: [] };
      } else if (snap.text && stable >= 2) {
        return snap;
      }
    }
    throw new Error(`Tempo esgotado (${Math.round(timeoutMs / 60000)} min) aguardando resposta do ChatGPT`);
  }

  private checkProblems(text: string): void {
    if (LIMIT_PATTERN.test(text)) {
      throw new RateLimitError(`ChatGPT informou limite de uso: "${text.slice(0, 180)}"`, parseWaitMinutes(text));
    }
    if (REFUSAL_PATTERN.test(text)) {
      throw new RefusedError(`ChatGPT recusou o prompt: "${text.slice(0, 180)}"`);
    }
  }

  /** Envia uma pergunta de texto e devolve a resposta (usado para criar prompts/metadados). */
  async ask(message: string, timeoutMs = 4 * 60_000): Promise<string> {
    await this.newChat(false);
    await this.send(message);
    const snap = await this.waitForReply(timeoutMs, false);
    if (LIMIT_PATTERN.test(snap.text) && snap.text.length < 600) this.checkProblems(snap.text);
    return snap.text;
  }

  /** Gera uma imagem no ChatGPT e devolve os bytes do arquivo original. */
  async generateImage(prompt: string): Promise<Buffer> {
    await this.newChat(true);
    const message = [
      'Generate exactly one image now. Do not ask questions and do not reply with text only.',
      `Format: ${SIZE_HINT[this.settings.aspectRatio]}, maximum resolution and detail, commercial stock quality.`,
      'The image must not contain any text, letters, logos, watermarks, signatures or brand names.',
      '',
      prompt,
    ].join('\n');
    await this.send(message);
    const snap = await this.waitForReply(this.settings.imageTimeoutMin * 60_000, true);
    if (snap.images.length === 0) {
      this.checkProblems(snap.text);
      throw new Error(`O ChatGPT respondeu sem imagem: "${snap.text.slice(0, 180) || '(vazio)'}"`);
    }
    const best = [...snap.images].sort((a, b) => b.w * b.h - a.w * a.h)[0];
    log.info(`Imagem pronta no ChatGPT (${best.w}×${best.h}). Baixando…`);
    return downloadImage(this.page, best.src);
  }
}
