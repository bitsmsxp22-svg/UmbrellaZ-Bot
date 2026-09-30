import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { MockProvider } from '../src/providers/mock.js';
import { RateLimiter } from '../src/rate-limit.js';
import { listen, logoPng, testConfig, waitFor } from './helpers.js';

async function startApp(overrides = {}, provider = new MockProvider({ delayMs: 5 })) {
  const { app, jobs } = createApp({ config: testConfig(overrides), provider });
  const srv = await listen(app);
  return { ...srv, jobs, close: async () => { jobs.shutdown(); await srv.close(); } };
}

const form = (fields, files = []) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const f of files) fd.append('images', new Blob([f.data], { type: f.type }), f.name);
  return fd;
};

test('fluxo completo: gera 5 amostras SVG/PNG sem vazar provedor ou modelo', async () => {
  const s = await startApp();
  try {
    const png = await logoPng();
    const res = await fetch(`${s.url}/api/generate`, {
      method: 'POST',
      body: form({ prompt: 'Logo para "Casa Verde", paisagismo' }, [{ data: png, type: 'image/png', name: 'ref.png' }]),
    });
    assert.equal(res.status, 202);
    const { id } = await res.json();
    assert.match(id, /^[a-f0-9]{32}$/);

    const job = await waitFor(async () => {
      const j = await (await fetch(`${s.url}/api/jobs/${id}`)).json();
      return j.state === 'done' ? j : null;
    });
    assert.equal(job.samples.length, 5);
    assert.ok(job.samples.every((x) => x.status === 'done' && x.title));
    const raw = JSON.stringify(job);
    assert.doesNotMatch(raw, /gpt|openai|pollinations|image_prompt|MOCK#/i);

    const svg = await fetch(`${s.url}/api/jobs/${id}/samples/0.svg?download=1`);
    assert.equal(svg.status, 200);
    assert.match(svg.headers.get('content-type'), /image\/svg\+xml/);
    assert.match(svg.headers.get('content-disposition'), /logo-1\.svg/);
    assert.match(svg.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal(svg.headers.get('x-powered-by'), null);
    assert.match(await svg.text(), /^<svg[^>]+viewBox=/);

    const pngRes = await fetch(`${s.url}/api/jobs/${id}/samples/4.png`);
    assert.equal(pngRes.headers.get('content-type'), 'image/png');

    assert.equal((await fetch(`${s.url}/api/jobs/${id}/samples/9.svg`)).status, 404);
    assert.equal((await fetch(`${s.url}/api/jobs/${'0'.repeat(32)}`)).status, 404);
    assert.equal((await fetch(`${s.url}/api/jobs/../../etc/passwd`)).status, 404);
  } finally {
    await s.close();
  }
});

test('validações: descrição curta, arquivo inválido, imagem corrompida e excesso de arquivos', async () => {
  const s = await startApp();
  try {
    let r = await fetch(`${s.url}/api/generate`, { method: 'POST', body: form({ prompt: 'a' }) });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /mínimo/);

    r = await fetch(`${s.url}/api/generate`, {
      method: 'POST', body: form({ prompt: 'logo teste' }, [{ data: Buffer.from('x'), type: 'application/pdf', name: 'a.pdf' }]),
    });
    assert.equal(r.status, 400);

    r = await fetch(`${s.url}/api/generate`, {
      method: 'POST', body: form({ prompt: 'logo teste' }, [{ data: Buffer.from('não é png'), type: 'image/png', name: 'a.png' }]),
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /inválida/);

    const png = await logoPng();
    const four = Array.from({ length: 4 }, (_, i) => ({ data: png, type: 'image/png', name: `${i}.png` }));
    r = await fetch(`${s.url}/api/generate`, { method: 'POST', body: form({ prompt: 'logo teste' }, four) });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /no máximo 3/);

    r = await fetch(`${s.url}/api/nada`);
    assert.equal(r.status, 404);
    assert.ok((await r.json()).error);
  } finally {
    await s.close();
  }
});

test('limite por IP responde 429 com Retry-After, e erros de validação não consomem a cota', async () => {
  const s = await startApp({ rateLimit: { max: 1, windowMs: 60_000 } });
  try {
    await fetch(`${s.url}/api/generate`, {
      method: 'POST', body: form({ prompt: 'x' }),
    });
    const ok = await fetch(`${s.url}/api/generate`, { method: 'POST', body: form({ prompt: 'logo um' }) });
    assert.equal(ok.status, 202);
    const blocked = await fetch(`${s.url}/api/generate`, { method: 'POST', body: form({ prompt: 'logo dois' }) });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  } finally {
    await s.close();
  }
});

test('se a geração de imagem cair, o plano B (SVG direto) ainda entrega as amostras', async () => {
  const provider = new MockProvider({ delayMs: 5 });
  provider.image = async () => { throw new Error('serviço de imagem fora do ar'); };
  const s = await startApp({}, provider);
  try {
    const { id } = await (await fetch(`${s.url}/api/generate`, { method: 'POST', body: form({ prompt: 'logo "Plano B"' }) })).json();
    const job = await waitFor(async () => {
      const j = await (await fetch(`${s.url}/api/jobs/${id}`)).json();
      return j.state !== 'running' && j.state !== 'queued' ? j : null;
    });
    assert.equal(job.state, 'done');
    assert.ok(job.samples.every((x) => x.status === 'done'));
  } finally {
    await s.close();
  }
});

test('RateLimiter: janela deslizante e devolução', () => {
  const rl = new RateLimiter({ max: 2, windowMs: 1000 });
  assert.equal(rl.take('a', 0), 0);
  assert.equal(rl.take('a', 10), 0);
  assert.equal(rl.take('a', 20), 980);
  rl.refund('a');
  assert.equal(rl.take('a', 30), 0);
  assert.equal(rl.take('a', 1500), 0);
  clearInterval(rl.timer);
});
