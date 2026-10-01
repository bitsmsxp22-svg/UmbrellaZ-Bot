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
 * Controla a cota grátis do servidor. Quando ela acaba (HTTP 402) ou o saldo não cobre um pedido,
 * os pedidos seguem para o modo do visitante até a próxima recarga.
 */
export class Budget {
  constructor({ provider, refill, checkBalance, jobCost }) {
    this.provider = provider;
    this.refill = refill;
    this.checkBalance = checkBalance && typeof provider?.balance === 'function';
    this.jobCost = jobCost;
    this.exhaustedUntil = 0;
    this.cached = null; // { value, at }
  }

  get exhausted() {
    return Date.now() < this.exhaustedUntil;
  }

  markExhausted(now = Date.now()) {
    if (now < this.exhaustedUntil) return;
    this.exhaustedUntil = nextRefill(now, this.refill);
    this.cached = null;
    log.warn(`cota grátis do servidor esgotada; modo do visitante até ${new Date(this.exhaustedUntil).toISOString()}`);
  }

  /** true se o servidor pode assumir mais um pedido agora. */
  async canAfford() {
    if (!this.provider || this.exhausted) return false;
    if (!this.checkBalance) return true;
    const now = Date.now();
    if (!this.cached || now - this.cached.at > 60_000) {
      try {
        const value = await this.provider.balance();
        this.cached = value === null ? null : { value, at: now };
        if (value === null) this.checkBalance = false;
      } catch (err) {
        // Sem permissão de leitura de saldo, ou falha temporária: confia no 402 como sinal.
        log.warn(`saldo indisponível (${err.message}); usando apenas o sinal de cota esgotada`);
        this.checkBalance = false;
        return true;
      }
    }
    if (!this.cached) return true;
    if (this.cached.value < this.jobCost) {
      this.markExhausted(now);
      return false;
    }
    // Reserva o custo estimado para não aceitar mais pedidos do que o saldo cobre.
    this.cached.value -= this.jobCost;
    return true;
  }
}
