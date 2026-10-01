import assert from 'node:assert/strict';
import test from 'node:test';
import { Budget, estimateJobCost, nextRefill } from '../src/budget.js';
import { isPrivateAddress } from '../src/fetch-image.js';

test('nextRefill: próxima hora cheia ou próxima meia-noite UTC', () => {
  const now = Date.UTC(2026, 9, 1, 14, 37, 12);
  assert.equal(nextRefill(now, 'hourly'), Date.UTC(2026, 9, 1, 15, 0, 5));
  assert.equal(nextRefill(now, 'daily'), Date.UTC(2026, 9, 2, 0, 0, 5));
  assert.equal(nextRefill(Date.UTC(2026, 11, 31, 23, 59), 'hourly'), Date.UTC(2027, 0, 1, 0, 0, 5));
});

test('estimateJobCost cresce com a qualidade', () => {
  assert.ok(estimateJobCost(5, 'low') < estimateJobCost(5, 'medium'));
  assert.ok(estimateJobCost(5, 'medium') < estimateJobCost(5, 'high'));
});

test('Budget: aceita com saldo positivo, reserva o custo e pausa até a recarga com saldo zerado', async () => {
  let balance = 0.15;
  let calls = 0;
  const provider = { balance: async () => { calls += 1; return balance; } };
  const b = new Budget({ provider, refill: 'hourly', checkBalance: true, jobCost: 0.53 });
  assert.equal(await b.canAfford(), true, 'cota Seed (0,15) aceita um pedido premium (0,53)');
  assert.equal(await b.canAfford(), false, 'saldo já reservado');
  assert.equal(b.exhausted, false, 'reserva não pausa até a recarga');
  assert.equal(calls, 1, 'saldo consultado uma vez');

  balance = -0.2;
  const z = new Budget({ provider, refill: 'hourly', checkBalance: true, jobCost: 0.53 });
  assert.equal(await z.canAfford(), false);
  assert.equal(z.exhausted, true, 'saldo real zerado/negativo pausa até a recarga');

  const noProvider = new Budget({ provider: null, refill: 'hourly', checkBalance: true, jobCost: 0.07 });
  assert.equal(await noProvider.canAfford(), false);

  const failing = new Budget({ provider: { balance: async () => { throw new Error('403'); } }, refill: 'hourly', checkBalance: true, jobCost: 1 });
  assert.equal(await failing.canAfford(), true, 'sem leitura de saldo, confia no 402');
});

test('isPrivateAddress bloqueia rede interna e libera IP público', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '151.101.1.1', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('teto diário: para de aceitar pedidos ao atingir o orçamento do dia', async () => {
  const b = new Budget({ provider: {}, refill: 'hourly', checkBalance: false, jobCost: 0.5, dailyCap: 1.2 });
  assert.equal(await b.canAfford(), true);
  assert.equal(await b.canAfford(), true);
  assert.equal(await b.canAfford(), false, 'terceiro pedido passaria do teto');
  assert.equal(b.exhausted, true);
  const d = new Date(b.exhaustedUntil);
  assert.equal(d.getUTCHours(), 0, 'volta à meia-noite UTC');
});
