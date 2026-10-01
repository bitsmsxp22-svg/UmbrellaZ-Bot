import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { ProviderError } from '../src/providers/http.js';
import { MockProvider } from '../src/providers/mock.js';
import { listen, logoPng, testConfig, waitFor } from './helpers.js';

async function startApp(overrides = {}, provider = null) {
  const { app, jobs } = createApp({ config: testConfig({ clientFallback: true, ...overrides }), provider });
  const srv = await listen(app);
  return { ...srv, jobs, close: async () => { jobs.shutdown(); await srv.close(); } };
}

const generate = (url, prompt = 'Logo para "Casa Verde", paisagismo') => {
  const fd = new FormData();
  fd.append('prompt', prompt);
  return fetch(`${url}/api/generate`, { method: 'POST', body: fd });
};

const conceptsJson = (n = 5) => JSON.stringify({
  brand: 'Casa Verde',
  concepts: Array.from({ length: n }, (_, i) => ({
    title: `Ideia ${i + 1}`, description: 'desc', palette: ['#2A9D8F'], image_prompt: `A leaf symbol number ${i + 1} with "Casa Verde"`,
  })),
});

const postImage = async (url, id, index, png) => {
  const fd = new FormData();
  fd.append('image', new Blob([png], { type: 'image/png' }), 'x.png');
  return fetch(`${url}/api/jobs/${id}/samples/${index}/image`, { method: 'POST', body: fd });
};

const postJson = (url, path, body) => fetch(`${url}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('sem chave no servidor: fluxo completo pela cota do visitante, com vetorização no servidor', async () => {
  const s = await startApp();
  try {
    assert.equal((await (await fetch(`${s.url}/api/status`)).json()).mode, 'client');

    const res = await generate(s.url);
    assert.equal(res.status, 202);
    const job = await res.json();
    assert.equal(job.state, 'client');
    assert.equal(job.client.stage, 'concepts');
    assert.equal(job.client.textModel, 'openai/gpt-5.6-sol');
    assert.equal(job.client.imageModel, 'openai/gpt-image-2');
    assert.match(job.client.prompt, /Casa Verde/);

    const png = await logoPng();
    assert.equal((await postImage(s.url, job.id, 0, png)).status, 409, 'imagem antes dos conceitos');

    const afterConcepts = await (await postJson(s.url, `/api/jobs/${job.id}/concepts`, { text: conceptsJson() })).json();
    assert.equal(afterConcepts.client.stage, 'images');
    assert.equal(afterConcepts.client.prompts.length, 5);
    assert.match(afterConcepts.client.prompts[0].prompt, /flat 2D vector/);
    assert.equal(afterConcepts.samples[0].title, 'Ideia 1');
    assert.equal((await postJson(s.url, `/api/jobs/${job.id}/concepts`, { text: conceptsJson() })).status, 409, 'conceitos só uma vez');

    for (let i = 0; i < 4; i += 1) {
      const r = await postImage(s.url, job.id, i, png);
      assert.equal(r.status, 200);
      assert.equal((await r.json()).samples[i].status, 'done');
    }
    const last = await (await postJson(s.url, `/api/jobs/${job.id}/samples/4/image`, { failed: true })).json();
    assert.equal(last.state, 'done');
    assert.equal(last.client, undefined);
    assert.equal(last.samples.filter((x) => x.status === 'done').length, 4);

    const svg = await fetch(`${s.url}/api/jobs/${job.id}/samples/2.svg`);
    assert.equal(svg.status, 200);
    assert.match(await svg.text(), /^<svg[^>]+viewBox=/);
  } finally {
    await s.close();
  }
});

test('resposta de conceitos inválida usa conceitos locais e segue normalmente', async () => {
  const s = await startApp();
  try {
    const job = await (await generate(s.url)).json();
    const r = await (await postJson(s.url, `/api/jobs/${job.id}/concepts`, { text: 'não é json' })).json();
    assert.equal(r.client.prompts.length, 5);
    assert.ok(r.samples.every((x) => x.title));
  } finally {
    await s.close();
  }
});

test('URL de imagem apontando para rede interna é bloqueada (SSRF)', async () => {
  const s = await startApp();
  try {
    const job = await (await generate(s.url)).json();
    await postJson(s.url, `/api/jobs/${job.id}/concepts`, { text: conceptsJson() });
    for (const url of ['https://127.0.0.1/x.png', 'http://example.com/x.png', 'https://169.254.169.254/latest']) {
      const r = await postJson(s.url, `/api/jobs/${job.id}/samples/0/image`, { url });
      assert.equal(r.status, 400, url);
    }
    // Arquivo que não é imagem: 400 e a amostra continua disponível para reenvio.
    const bad = await postImage(s.url, job.id, 0, Buffer.from('lixo'));
    assert.equal(bad.status, 400);
    assert.equal((await postImage(s.url, job.id, 0, await logoPng())).status, 200);
  } finally {
    await s.close();
  }
});

test('cota do servidor esgota nas imagens: o restante passa para o visitante e os próximos pedidos já vão direto', async () => {
  const provider = new MockProvider({ delayMs: 5 });
  let images = 0;
  const original = provider.image.bind(provider);
  provider.image = async (args) => {
    images += 1;
    if (images > 2) throw new ProviderError('HTTP 402', { status: 402, budget: true });
    return original(args);
  };
  const s = await startApp({}, provider);
  try {
    assert.equal((await (await fetch(`${s.url}/api/status`)).json()).mode, 'server');
    const { id } = await (await generate(s.url)).json();
    const job = await waitFor(async () => {
      const j = await (await fetch(`${s.url}/api/jobs/${id}`)).json();
      return j.state === 'client' ? j : null;
    });
    assert.equal(job.client.stage, 'images');
    assert.equal(job.samples.filter((x) => x.status === 'done').length, 2);
    assert.equal(job.client.prompts.length, 3);
    assert.equal(s.jobs.budget.exhausted, true);

    for (const { index } of job.client.prompts) await postImage(s.url, id, index, await logoPng());
    assert.equal((await (await fetch(`${s.url}/api/jobs/${id}`)).json()).state, 'done');

    assert.equal((await (await fetch(`${s.url}/api/status`)).json()).mode, 'client');
    const next = await (await generate(s.url)).json();
    assert.equal(next.state, 'client');
    assert.equal(next.client.stage, 'concepts');
  } finally {
    await s.close();
  }
});

test('cota esgota já nos conceitos: o visitante gera conceitos e imagens', async () => {
  const provider = new MockProvider({ delayMs: 5 });
  provider.chat = async () => { throw new ProviderError('HTTP 402', { status: 402, budget: true }); };
  const s = await startApp({}, provider);
  try {
    const { id } = await (await generate(s.url)).json();
    const job = await waitFor(async () => {
      const j = await (await fetch(`${s.url}/api/jobs/${id}`)).json();
      return j.state === 'client' ? j : null;
    });
    assert.equal(job.client.stage, 'concepts');
    assert.match(job.client.prompt, /Casa Verde/);
  } finally {
    await s.close();
  }
});

test('modo do visitante desligado: cota esgotada responde 503 com horário de retorno', async () => {
  const provider = new MockProvider({ delayMs: 5 });
  const s = await startApp({ clientFallback: false }, provider);
  try {
    s.jobs.budget.markExhausted();
    const r = await generate(s.url);
    assert.equal(r.status, 503);
    assert.match((await r.json()).error, /Volte a partir das \d\d:\d\d/);
  } finally {
    await s.close();
  }
});

test('cabeçalhos: Puter liberado na CSP e COOP compatível com o popup só quando o modo do visitante está ativo', async () => {
  const on = await startApp();
  const off = await startApp({ clientFallback: false }, new MockProvider({ delayMs: 5 }));
  try {
    const h1 = (await fetch(`${on.url}/`)).headers;
    assert.match(h1.get('content-security-policy'), /script-src 'self' https:\/\/js\.puter\.com/);
    assert.equal(h1.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
    const h2 = (await fetch(`${off.url}/`)).headers;
    assert.doesNotMatch(h2.get('content-security-policy'), /puter/);
    assert.equal(h2.get('cross-origin-opener-policy'), 'same-origin');
  } finally {
    await on.close();
    await off.close();
  }
});
