import path from 'node:path';
import fs from 'node:fs';
import type { FileChooser, Locator, Page, Request } from 'playwright';
import { browser } from './browser';
import { log } from './bus';
import { CONTRIBUTOR_TEXT, selectors, type SelectorKey } from './selectors';
import type { Settings } from './settings';
import { NeedsLoginError, errorMessage, sleep, throwIfAborted } from './util';

export interface UploadOutcome {
  /** Arquivos confirmados no portal (pelo nome do arquivo). */
  confirmed: string[];
  /** Arquivos não encontrados na verificação. */
  missing: string[];
  /** O portal mostrou a mensagem de envio concluído. */
  portalReportedSuccess: boolean;
  csvSent: boolean;
  submitted: boolean;
  notes: string[];
}

const ROLES = ['button', 'link', 'menuitem', 'tab'] as const;

/**
 * Automação do portal do colaborador (contributor.stock.adobe.com) pela interface web,
 * usando a sessão já logada no navegador do sistema. Fluxo: enviar imagens → conferir que
 * chegaram → enviar o CSV de metadados → (opcional) marcar "IA generativa" e enviar para revisão.
 */
export class AdobeContributorWeb {
  private sel: (key: SelectorKey) => string;

  private constructor(
    private page: Page,
    private settings: Settings,
    private signal: AbortSignal,
  ) {
    this.sel = selectors(settings.selectorOverrides);
  }

  static async open(settings: Settings, signal: AbortSignal): Promise<AdobeContributorWeb> {
    const page = await browser.page(settings, 'adobe');
    const client = new AdobeContributorWeb(page, settings, signal);
    await client.gotoUploads();
    return client;
  }

  private uploadsUrl(): string {
    return new URL('uploads', this.settings.adobeContributorUrl).toString();
  }

  async gotoUploads(): Promise<void> {
    throwIfAborted(this.signal);
    await this.page.goto(this.uploadsUrl(), { waitUntil: 'domcontentloaded', timeout: 90_000 });
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      throwIfAborted(this.signal);
      const url = this.page.url();
      if (/adobelogin|auth\.services\.adobe\.com|account\.adobe\.com|\/signin|ims-na1/i.test(url)) break;
      if (await this.findClickable(CONTRIBUTOR_TEXT.upload, 500)) return;
      if ((await this.page.locator(this.sel('contributor.fileInput')).count()) > 0) return;
      await sleep(1500, this.signal);
    }
    await this.page.bringToFront().catch(() => undefined);
    const shot = await browser.screenshot(this.page, 'adobe-login');
    throw new NeedsLoginError(
      'adobe',
      `O portal do colaborador do Adobe Stock não está logado. Clique em "Abrir navegador", entre na sua conta de colaborador nessa janela (o login fica salvo).${shot ? ` Captura: ${shot}` : ''}`,
    );
  }

  private async findClickable(pattern: RegExp, timeout = 4000, scope: Page | Locator = this.page): Promise<Locator | null> {
    const deadline = Date.now() + timeout;
    do {
      for (const role of ROLES) {
        const loc = scope.getByRole(role, { name: pattern }).first();
        if (await loc.isVisible().catch(() => false)) return loc;
      }
      const byText = scope.getByText(pattern).first();
      if (await byText.isVisible().catch(() => false)) return byText;
      await sleep(300, this.signal);
    } while (Date.now() < deadline);
    return null;
  }

  private async click(pattern: RegExp, timeout = 4000, scope?: Page | Locator): Promise<boolean> {
    const loc = await this.findClickable(pattern, timeout, scope);
    if (!loc) return false;
    await loc.click();
    return true;
  }

  private async bodyText(): Promise<string> {
    return this.page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
  }

  /** Seleciona arquivos no campo de upload (input direto ou janela de seleção de arquivos). */
  private async chooseFiles(files: string[], inputKey: SelectorKey, openButton: RegExp): Promise<void> {
    let input = this.page.locator(this.sel(inputKey));
    if ((await input.count()) === 0) {
      const chooser = this.page.waitForEvent('filechooser', { timeout: 15_000 }).catch(() => null);
      if (!(await this.click(openButton, 10_000))) throw new Error(`botão "${openButton.source}" não encontrado no portal`);
      const direct = await Promise.race([chooser, sleep(2500, this.signal).then(() => null)]);
      if (direct) return (direct as FileChooser).setFiles(files);
      input = this.page.locator(this.sel(inputKey));
      if ((await input.count()) === 0) {
        const chooser2 = this.page.waitForEvent('filechooser', { timeout: 15_000 }).catch(() => null);
        if (!(await this.click(CONTRIBUTOR_TEXT.browse, 8000))) throw new Error('botão para escolher arquivos não encontrado');
        const fc = await chooser2;
        if (!fc) throw new Error('a janela de seleção de arquivos não abriu');
        return fc.setFiles(files);
      }
    }
    await input.first().setInputFiles(files);
  }

  /** Número de arquivos na aba "Novos" do portal (ex.: "New (5)", "Novos (5)"), se aparecer na página. */
  async newCount(): Promise<number | null> {
    const text = await this.bodyText();
    const m = text.match(/\b(?:new|novos?|nuevos?|nouveaux?|neu)\s*\(?\s*(\d{1,6})\s*\)?/i);
    return m ? Number(m[1]) : null;
  }

  /** Captura de tela + HTML do portal (vai para o diagnóstico). */
  async snapshot(label: string): Promise<string | null> {
    return browser.screenshot(this.page, `adobe-${label}`);
  }

  /**
   * Envia as imagens e acompanha o upload pelo TRÁFEGO DE REDE (quantos bytes subiram e se o
   * portal respondeu OK), que não depende do layout do site. A mensagem de "upload concluído"
   * também vale como sinal.
   */
  async uploadImages(files: string[]): Promise<{ doneText: boolean; uploadedBytes: number; totalBytes: number }> {
    const totalBytes = files.reduce((sum, f) => sum + fs.statSync(f).size, 0);
    let uploadedBytes = 0;
    let lastUploadAt = Date.now();
    const ctx = this.page.context();
    const onFinished = async (req: Request) => {
      if (!['POST', 'PUT', 'PATCH'].includes(req.method())) return;
      // Em uploads de arquivo (FormData/Blob) o Chromium informa requestBodySize = 0;
      // o tamanho real vem do cabeçalho Content-Length.
      const headers = await req.allHeaders().catch(() => ({}) as Record<string, string>);
      const sizes = await req.sizes().catch(() => null);
      const size = Math.max(Number(headers['content-length'] ?? 0) || 0, sizes?.requestBodySize ?? 0);
      const resp = await req.response().catch(() => null);
      if (size > 50_000 && resp && resp.status() < 400) {
        uploadedBytes += size;
        lastUploadAt = Date.now();
      }
    };
    ctx.on('requestfinished', onFinished);
    try {
      await this.chooseFiles(files, 'contributor.fileInput', CONTRIBUTOR_TEXT.upload);
      log.info(`Enviando ${files.length} imagem(ns) ao portal do Adobe Stock (${(totalBytes / 1048576).toFixed(1)} MB)…`);
      const timeout = (3 + files.length * 2) * 60_000;
      const start = Date.now();
      let doneText = false;
      while (Date.now() - start < timeout) {
        await sleep(3000, this.signal);
        const text = await this.bodyText();
        if (CONTRIBUTOR_TEXT.uploadDone.test(text)) doneText = true;
        if (uploadedBytes >= totalBytes * 0.9 || doneText) {
          await sleep(4000, this.signal); // deixa o portal registrar os arquivos
          break;
        }
        const busy = /(uploading|enviando|carregando|\d{1,3}\s?%)/i.test(text);
        if (!busy && Date.now() - start > 45_000 && Date.now() - lastUploadAt > 30_000) break;
      }
      await this.snapshot('apos-envio');
      await this.page.keyboard.press('Escape').catch(() => undefined);
      return { doneText, uploadedBytes, totalBytes };
    } finally {
      ctx.off('requestfinished', onFinished);
    }
  }

  /** Confere, pelo nome do arquivo, quais imagens aparecem no portal (aba "Novos"). */
  async confirm(filenames: string[], waitMs = 20_000): Promise<{ confirmed: string[]; missing: string[] }> {
    const start = Date.now();
    let found = new Set<string>();
    for (;;) {
      throwIfAborted(this.signal);
      await this.gotoUploads();
      await sleep(4000, this.signal);
      const html = await this.page.content();
      found = new Set(filenames.filter((f) => html.includes(f) || html.includes(path.parse(f).name)));
      if (found.size === filenames.length || Date.now() - start >= waitMs) break;
      await sleep(10_000, this.signal);
    }
    return { confirmed: filenames.filter((f) => found.has(f)), missing: filenames.filter((f) => !found.has(f)) };
  }

  /** Envia o CSV de metadados (títulos, palavras-chave, categorias) do lote. */
  async uploadCsv(csvPath: string): Promise<boolean> {
    await this.gotoUploads();
    await this.chooseFiles([csvPath], 'contributor.csvInput', CONTRIBUTOR_TEXT.uploadCsv);
    await sleep(1500, this.signal);
    const dialog = this.page.getByRole('dialog').last();
    if (await dialog.isVisible().catch(() => false)) {
      await this.click(CONTRIBUTOR_TEXT.csvConfirm, 5000, dialog);
    }
    const start = Date.now();
    while (Date.now() - start < 90_000) {
      await sleep(3000, this.signal);
      const text = await this.bodyText();
      if (CONTRIBUTOR_TEXT.csvDone.test(text)) return true;
      if (/(csv).*(error|erro|failed|falhou|invalid)/i.test(text)) throw new Error('o portal recusou o CSV');
    }
    return true;
  }

  /**
   * Marca "Criado com ferramentas de IA generativa" (obrigatório para esse tipo de conteúdo)
   * e envia os arquivos para revisão. Se a opção de IA não for encontrada, NÃO envia.
   */
  async submitForReview(filenames: string[]): Promise<boolean> {
    if (this.settings.csvApplyWaitSec > 0) {
      log.info(`Aguardando ${this.settings.csvApplyWaitSec}s para o Adobe aplicar o CSV antes de enviar para revisão…`);
      await sleep(this.settings.csvApplyWaitSec * 1000, this.signal);
    }
    await this.gotoUploads();
    await sleep(3000, this.signal);

    if (!(await this.click(CONTRIBUTOR_TEXT.selectAll, 4000))) {
      for (const f of filenames) {
        const stem = path.parse(f).name;
        const thumb = this.page.locator(`[title*="${stem}"], [alt*="${stem}"], [aria-label*="${stem}"]`).first();
        if (await thumb.isVisible().catch(() => false)) await thumb.click({ modifiers: ['ControlOrMeta'] });
      }
    }
    await sleep(1500, this.signal);

    const aiBox = await this.checkbox(CONTRIBUTOR_TEXT.generativeAi);
    if (!aiBox) throw new Error('opção "Criado com IA generativa" não encontrada — por segurança o envio para revisão não foi feito');
    await this.checkbox(CONTRIBUTOR_TEXT.fictional);
    await this.click(CONTRIBUTOR_TEXT.saveWork, 3000);
    await sleep(2000, this.signal);

    if (!(await this.click(CONTRIBUTOR_TEXT.submit, 6000))) throw new Error('botão "Submit/Enviar" não encontrado');
    await sleep(2000, this.signal);
    const dialog = this.page.getByRole('dialog').last();
    if (await dialog.isVisible().catch(() => false)) {
      const boxes = dialog.getByRole('checkbox');
      for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check().catch(() => undefined);
      await this.click(CONTRIBUTOR_TEXT.submit, 5000, dialog);
    }
    await sleep(5000, this.signal);
    const text = await this.bodyText();
    if (CONTRIBUTOR_TEXT.submitLimit.test(text)) {
      throw new Error('limite semanal de envios para revisão do Adobe atingido (ele libera sozinho quando a fila é revisada)');
    }
    return true;
  }

  private async checkbox(pattern: RegExp): Promise<boolean> {
    const candidates = [this.page.getByLabel(pattern).first(), this.page.getByRole('checkbox', { name: pattern }).first()];
    for (const box of candidates) {
      if (await box.isVisible().catch(() => false)) {
        await box.check().catch(async () => box.click());
        return true;
      }
    }
    const label = this.page.getByText(pattern).first();
    if (await label.isVisible().catch(() => false)) {
      await label.click();
      return true;
    }
    return false;
  }
}

/** Fluxo completo de envio de um lote. Nunca lança erro por falha parcial — devolve o resultado. */
export async function uploadBatchToAdobe(
  files: { path: string; filename: string }[],
  csvPath: string,
  settings: Settings,
  signal: AbortSignal,
  /** Nova tentativa do mesmo lote: confere antes o que já chegou para não duplicar envios. */
  precheck = false,
): Promise<UploadOutcome> {
  const out: UploadOutcome = { confirmed: [], missing: files.map((f) => f.filename), portalReportedSuccess: false, csvSent: false, submitted: false, notes: [] };
  const portal = await AdobeContributorWeb.open(settings, signal);

  let toSend = files;
  if (precheck) {
    const already = await portal.confirm(files.map((f) => f.filename), 0);
    if (already.confirmed.length) log.info(`${already.confirmed.length} imagem(ns) deste lote já estavam no portal — não serão reenviadas.`);
    toSend = files.filter((f) => !already.confirmed.includes(f.filename));
  }
  // O portal costuma travar com muitos arquivos de uma vez: envia em grupos de até 20.
  const countBefore = await portal.newCount();
  let uploadedBytes = 0;
  let totalBytes = 0;
  let doneText = toSend.length > 0;
  for (let i = 0; i < toSend.length; i += 20) {
    const r = await portal.uploadImages(toSend.slice(i, i + 20).map((f) => f.path));
    uploadedBytes += r.uploadedBytes;
    totalBytes += r.totalBytes;
    doneText &&= r.doneText;
    if (i + 20 < toSend.length) await portal.gotoUploads();
  }
  const check = await portal.confirm(files.map((f) => f.filename));
  const countAfter = await portal.newCount();
  out.confirmed = check.confirmed;
  out.missing = check.missing;

  // Três sinais independentes do layout: bytes enviados, contador "Novos" e mensagem do portal.
  const byNetwork = totalBytes > 0 && uploadedBytes >= totalBytes * 0.9;
  const byCount = countBefore !== null && countAfter !== null && countAfter - countBefore >= toSend.length;
  out.portalReportedSuccess = toSend.length === 0 || byNetwork || byCount || doneText;
  const how = [
    byNetwork && `tráfego de rede: ${(uploadedBytes / 1048576).toFixed(1)} de ${(totalBytes / 1048576).toFixed(1)} MB enviados`,
    byCount && `aba Novos: ${countBefore} → ${countAfter}`,
    doneText && 'mensagem de upload concluído',
    check.confirmed.length && `${check.confirmed.length} nome(s) de arquivo na página`,
  ].filter(Boolean);
  if (how.length) log.info(`Envio conferido por ${how.join('; ')}.`);

  if (out.confirmed.length === 0 && !out.portalReportedSuccess) {
    const shot = await portal.snapshot('sem-confirmacao');
    out.notes.push(
      `o portal não confirmou o recebimento das imagens (enviado pela rede: ${(uploadedBytes / 1048576).toFixed(1)} de ${(totalBytes / 1048576).toFixed(1)} MB; aba Novos: ${countBefore ?? '?'} → ${countAfter ?? '?'})${shot ? ` — captura: ${shot}` : ''}`,
    );
    return out;
  }

  try {
    out.csvSent = await portal.uploadCsv(csvPath);
    await portal.snapshot('apos-csv');
    log.success('CSV de metadados enviado ao portal.');
  } catch (err) {
    if (err instanceof Error && err.name === 'StopError') throw err;
    const shot = await portal.snapshot('csv');
    out.notes.push(`CSV: ${errorMessage(err)}${shot ? ` (captura: ${shot})` : ''}`);
    log.warn(`Não consegui enviar o CSV automaticamente (${errorMessage(err)}). Ele fica salvo em data/csv para envio manual.`);
  }

  if (settings.autoSubmit && out.csvSent) {
    try {
      out.submitted = await portal.submitForReview(files.map((f) => f.filename));
      await portal.snapshot('apos-revisao');
      if (out.submitted) log.success('Arquivos marcados como IA generativa e enviados para revisão.');
    } catch (err) {
      if (err instanceof Error && err.name === 'StopError') throw err;
      const shot = await portal.snapshot('revisao');
      out.notes.push(`revisão: ${errorMessage(err)}${shot ? ` (captura: ${shot})` : ''}`);
      log.warn(`Envio para revisão não concluído (${errorMessage(err)}). Os arquivos ficam na aba "Novos" do portal com os metadados do CSV.`);
    }
  }
  return out;
}
