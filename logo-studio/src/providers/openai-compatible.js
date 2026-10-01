import { log } from '../log.js';
import { MinuteLimiter, ProviderError, request, withRetries } from './http.js';

/**
 * Provedor para qualquer serviço com API no formato OpenAI
 * (Pollinations em gen.pollinations.ai/v1, OpenAI, etc.).
 * Tenta cada modelo da lista em ordem (principal -> fallbacks).
 */
export class OpenAICompatibleProvider {
  constructor(opts) {
    this.opts = opts;
    this.name = opts.name;
    this.imageLimiter = new MinuteLimiter(opts.imageRpm || 0);
  }

  /** Saldo atual (pollen) ou null se o provedor não informa. */
  async balance({ signal } = {}) {
    if (!this.opts.balanceUrl) return null;
    const res = await request(this.opts.balanceUrl, { headers: this.headers() }, { timeoutMs: 10_000, signal });
    const data = await res.json();
    const value = Number(data?.balance);
    return Number.isFinite(value) ? value : null;
  }

  headers(extra = {}) {
    const h = { ...extra };
    if (this.opts.apiKey) h.Authorization = `Bearer ${this.opts.apiKey}`;
    return h;
  }

  async #eachModel(models, label, fn) {
    let lastErr;
    for (const model of models) {
      try {
        return await fn(model);
      } catch (err) {
        if (!(err instanceof ProviderError) || err.fatal || err.budget) throw err;
        lastErr = err;
        log.warn(`${label}: modelo ${model} falhou (${err.message}); tentando o próximo`);
      }
    }
    throw lastErr ?? new ProviderError(`${label}: nenhum modelo configurado`);
  }

  /** Chat completions. `messages` no formato OpenAI (aceita image_url com data URI). */
  async chat({ messages, json = false, signal }) {
    const { baseUrl, textModels, reasoningEffort, textTimeoutMs, maxRetries } = this.opts;
    return this.#eachModel(textModels, 'texto', (model) =>
      withRetries(async () => {
        const body = { model, messages };
        if (json) body.response_format = { type: 'json_object' };
        if (reasoningEffort && reasoningEffort !== 'none') body.reasoning_effort = reasoningEffort;
        const res = await request(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: this.headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
        }, { timeoutMs: textTimeoutMs, signal });
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        const text = Array.isArray(content) ? content.map((c) => c.text ?? '').join('') : content;
        if (!text) throw new ProviderError('resposta de texto vazia', { retryable: true });
        return text;
      }, { retries: maxRetries, signal, label: `texto/${model}` }),
    );
  }

  /** Gera uma imagem. Com referências usa /images/edits; se falhar, cai para /images/generations. */
  async image({ prompt, refs = [], transparent = false, signal }) {
    const { imageModels, maxRetries } = this.opts;
    return this.#eachModel(imageModels, 'imagem', async (model) => {
      if (refs.length) {
        try {
          return await withRetries(() => this.#edit(model, prompt, refs, transparent, signal),
            { retries: maxRetries, signal, label: `edição/${model}` });
        } catch (err) {
          if (!(err instanceof ProviderError) || err.fatal || err.budget) throw err;
          log.warn(`edição/${model} indisponível (${err.message}); gerando sem imagem de referência`);
        }
      }
      return withRetries(() => this.#generate(model, prompt, transparent, signal),
        { retries: maxRetries, signal, label: `imagem/${model}` });
    });
  }

  #imageParams(model, transparent) {
    const { imageSize, imageQuality, imageExtras, transparentExtras } = this.opts;
    return { model, n: 1, size: imageSize, quality: imageQuality, ...imageExtras, ...(transparent ? transparentExtras : {}) };
  }

  async #generate(model, prompt, transparent, signal) {
    await this.imageLimiter.wait(signal);
    const res = await request(`${this.opts.baseUrl}/images/generations`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ...this.#imageParams(model, transparent), prompt }),
    }, { timeoutMs: this.opts.imageTimeoutMs, signal });
    return this.#readImage(res, signal);
  }

  async #edit(model, prompt, refs, transparent, signal) {
    await this.imageLimiter.wait(signal);
    const form = new FormData();
    for (const [k, v] of Object.entries(this.#imageParams(model, transparent))) form.append(k, String(v));
    form.append('prompt', prompt);
    refs.forEach((ref, i) => form.append(this.opts.editImageField, new Blob([ref.buffer], { type: 'image/png' }), `ref-${i}.png`));
    const res = await request(`${this.opts.baseUrl}/images/edits`, {
      method: 'POST',
      headers: this.headers(),
      body: form,
    }, { timeoutMs: this.opts.imageTimeoutMs, signal });
    return this.#readImage(res, signal);
  }

  async #readImage(res, signal) {
    const type = res.headers.get('content-type') || '';
    if (type.startsWith('image/')) return Buffer.from(await res.arrayBuffer());
    const data = await res.json();
    const item = data?.data?.[0];
    if (item?.b64_json) return Buffer.from(item.b64_json, 'base64');
    if (item?.url) {
      const img = await request(item.url, {}, { timeoutMs: this.opts.imageTimeoutMs, signal });
      return Buffer.from(await img.arrayBuffer());
    }
    throw new ProviderError('resposta de imagem sem conteúdo', { retryable: true });
  }
}
