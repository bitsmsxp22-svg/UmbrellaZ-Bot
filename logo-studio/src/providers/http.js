import { log } from '../log.js';

export class ProviderError extends Error {
  constructor(message, { status = 0, retryable = false, fatal = false, budget = false, retryAfterMs = 0 } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.retryable = retryable;
    this.fatal = fatal;
    // Cota/saldo esgotado (HTTP 402): outros modelos da mesma conta também falhariam.
    this.budget = budget;
    this.retryAfterMs = retryAfterMs;
  }
}

export const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
  });

function parseRetryAfter(res) {
  const raw = res.headers.get('retry-after');
  if (!raw) return 0;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return secs * 1000;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

/**
 * fetch com timeout, cancelamento e classificação de erros.
 * Devolve a Response (status 2xx) ou lança ProviderError.
 */
export async function request(url, init, { timeoutMs, signal }) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res;
  try {
    res = await fetch(url, { ...init, signal: combined });
  } catch (err) {
    if (signal?.aborted) throw signal.reason ?? err;
    const isTimeout = timeout.aborted;
    throw new ProviderError(isTimeout ? 'timeout' : `rede: ${err.cause?.code || err.message}`, { retryable: true });
  }
  if (res.ok) return res;

  const body = (await res.text().catch(() => '')).slice(0, 500);
  const status = res.status;
  const retryAfterMs = parseRetryAfter(res);
  throw new ProviderError(`HTTP ${status}: ${body}`, {
    status,
    retryAfterMs,
    retryable: status === 408 || status === 409 || status === 429 || status >= 500,
    fatal: status === 401 || status === 403,
    budget: status === 402,
  });
}

/**
 * Executa fn com novas tentativas (backoff exponencial + Retry-After).
 * Erros não-retentáveis sobem imediatamente para o chamador decidir (ex.: trocar de modelo).
 */
export async function withRetries(fn, { retries, signal, label }) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (!(err instanceof ProviderError) || !err.retryable || attempt >= retries || signal?.aborted) throw err;
      const backoff = Math.min(30_000, Math.max(err.retryAfterMs, 1500 * 2 ** attempt + Math.random() * 500));
      log.warn(`${label}: tentativa ${attempt + 1} falhou (${err.message}); nova tentativa em ${Math.round(backoff)}ms`);
      await sleep(backoff, signal);
      attempt += 1;
    }
  }
}

/** Janela deslizante: no máximo `perMinute` chamadas por minuto (0 = sem limite). */
export class MinuteLimiter {
  constructor(perMinute) {
    this.perMinute = perMinute;
    this.stamps = [];
    this.chain = Promise.resolve();
  }

  wait(signal) {
    if (!this.perMinute) return Promise.resolve();
    const turn = this.chain.then(async () => {
      for (;;) {
        const now = Date.now();
        this.stamps = this.stamps.filter((t) => now - t < 60_000);
        if (this.stamps.length < this.perMinute) {
          this.stamps.push(now);
          return;
        }
        await sleep(60_000 - (now - this.stamps[0]) + 50, signal);
      }
    });
    this.chain = turn.catch(() => {});
    return turn;
  }
}
