/** Limite simples por IP (janela deslizante, em memória). */
export class RateLimiter {
  constructor({ max, windowMs }) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
    this.timer = setInterval(() => this.prune(), Math.min(windowMs, 10 * 60_000));
    this.timer.unref();
  }

  /** Retorna 0 se permitido (e registra), ou os ms até liberar. */
  take(key, now = Date.now()) {
    if (this.max <= 0) return 0;
    const list = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return this.windowMs - (now - list[0]);
    }
    list.push(now);
    this.hits.set(key, list);
    return 0;
  }

  /** Devolve uma tentativa (ex.: quando a requisição foi rejeitada por outro motivo). */
  refund(key) {
    const list = this.hits.get(key);
    if (list?.length) list.pop();
  }

  prune(now = Date.now()) {
    for (const [key, list] of this.hits) {
      if (!list.some((t) => now - t < this.windowMs)) this.hits.delete(key);
    }
  }
}
