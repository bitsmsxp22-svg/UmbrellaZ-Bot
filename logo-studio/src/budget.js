import { log } from './log.js';

const MARGIN_MS = 5_000;

/** Próxima recarga da cota grátis: início da próxima hora, ou 00:00 UTC do dia seguinte. */
export function nextRefill(now, refill) {
  const d = new Date(now);
  if (refill === 'daily') {
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) + MARGIN_MS;
  }
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours() + 1) + MARGIN_MS;
}

// Custo aproximado (pollen) de um pedido: conceitos no GPT-5.6 Sol + 5 imagens no GPT Image 2.
// Tabela pública do Pollinations: imagem ≈ tokens de saída × 0,0000225; texto ≈ 0,03 por pedido.
const IMAGE_COST = { low: 0.008, medium: 0.026, high: 0.1, hd: 0.1, auto: 0.026 };

export function estimateJobCost(samples, quality) {
  return 0.03 + samples * (IMAGE_COST[quality] ?? IMAGE_COST.medium);
}

/**
 * Controla os créditos do servidor: saldo, teto diário e esgotamento (HTTP 402).
 * Sem créditos, novos pedidos são recusados (ou vão para o modo do visitante, se ativado) até a recarga.
 */
export class Budget {
  constructor({ provider, refill, checkBalance, jobCost, dailyCap = 0 }) {
    this.provider = provider;
    this.refill = refill;
    this.checkBalance = checkBalance && typeof provider?.balance === 'function';
    this.jobCost = jobCost;
    this.exhaustedUntil = 0;
    this.cached = null; // { value, at }
    // Teto de gasto diário (estimado), para o uso comercial nunca passar do orçamento.
    this.dailyCap = dailyCap;
    this.day = '';
    this.spentToday = 0;
  }

  #dailyCapReached(now) {
    if (!this.dailyCap) return false;
    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.spentToday = 0;
    }
    if (this.spentToday + this.jobCost <= this.dailyCap) return false;
    this.exhaustedUntil = Math.max(this.exhaustedUntil, nextRefill(now, 'daily'));
    log.warn(`teto diário de gasto atingido (${this.spentToday.toFixed(2)} de ${this.dailyCap}); pausado até ${new Date(this.exhaustedUntil).toISOString()}`);
    return true;
  }

  get exhausted() {
    return Date.now() < this.exhaustedUntil;
  }

  markExhausted(now = Date.now()) {
    if (now < this.exhaustedUntil) return;
    this.exhaustedUntil = nextRefill(now, this.refill);
    this.cached = null;
    log.warn(`créditos do servidor esgotados (HTTP 402 ou saldo insuficiente); nova tentativa a partir de ${new Date(this.exhaustedUntil).toISOString()}`);
  }

  /** true se o servidor pode assumir mais um pedido agora. */
  async canAfford() {
    if (!this.provider || this.exhausted) return false;
    const now = Date.now();
    if (this.#dailyCapReached(now)) return false;
    if (!(await this.#balanceCovers(now))) return false;
    this.spentToday += this.jobCost;
    return true;
  }

  // O Pollinations aceita a chamada com saldo positivo e cobre a diferença na recarga seguinte.
  // Por isso a regra é "saldo > 0" (e não "saldo >= custo"): a cota Seed (0,15/h, não acumula)
  // nunca chegaria ao custo de um pedido premium (~0,5).
  async #balanceCovers(now) {
    if (!this.checkBalance) return true;
    const c = this.cached;
    const stale = !c || now - c.at > 60_000 || (c.value <= 0 && now - c.at > 10_000);
    if (stale) {
      try {
        const value = await this.provider.balance();
        this.cached = value === null ? null : { value, real: value, at: now };
        if (value === null) this.checkBalance = false;
      } catch (err) {
        // Sem permissão de leitura de saldo, ou falha temporária: confia no 402 como sinal.
        log.warn(`saldo indisponível (${err.message}); usando apenas o sinal de cota esgotada`);
        this.checkBalance = false;
        return true;
      }
    }
    if (!this.cached) return true;
    if (this.cached.real <= 0) {
      this.markExhausted(now);
      return false;
    }
    // Saldo já reservado por pedidos recentes: recusa por agora, sem pausar até a recarga.
    if (this.cached.value <= 0) return false;
    this.cached.value -= this.jobCost;
    return true;
  }
}
