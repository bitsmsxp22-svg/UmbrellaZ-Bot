import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderError } from '../src/providers/http.js';
import { OpenAICompatibleProvider } from '../src/providers/openai-compatible.js';
import { listen, logoPng, readBody } from './helpers.js';

function makeProvider(url, over = {}) {
  return new OpenAICompatibleProvider({
    baseUrl: `${url}/v1`,
    apiKey: 'sk_test',
    textModels: ['openai/gpt-5.6-sol', 'openai/gpt-5.5'],
    imageModels: ['openai/gpt-image-2', 'openai/gpt-image-1.5'],
    imageExtras: { response_format: 'b64_json' },
    transparentExtras: {},
    editImageField: 'image',
    reasoningEffort: 'low',
    imageSize: '1024x1024',
    imageQuality: 'high',
    textTimeoutMs: 5000,
    imageTimeoutMs: 5000,
    maxRetries: 2,
    ...over,
  });
}

test('chat envia modelo, chave e json_object; faz fallback de modelo e respeita Retry-After', async () => {
  const calls = [];
  let sol429 = 1;
  const srv = await listen(async (req, res) => {
    const body = JSON.parse((await readBody(req)).toString());
    calls.push({ path: req.url, auth: req.headers.authorization, body });
    if (body.model === 'openai/gpt-5.6-sol' && sol429-- > 0) {
      res.writeHead(429, { 'Retry-After': '0' }).end('{"error":"slow down"}');
      return;
    }
    if (body.model === 'openai/gpt-5.6-sol') {
      res.writeHead(404).end('{"error":"model not found"}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
  });
  try {
    const out = await makeProvider(srv.url).chat({ json: true, messages: [{ role: 'user', content: 'oi' }] });
    assert.equal(out, '{"ok":true}');
    assert.deepEqual(calls.map((c) => c.body.model), ['openai/gpt-5.6-sol', 'openai/gpt-5.6-sol', 'openai/gpt-5.5']);
    assert.equal(calls[0].path, '/v1/chat/completions');
    assert.equal(calls[0].auth, 'Bearer sk_test');
    assert.deepEqual(calls[0].body.response_format, { type: 'json_object' });
    assert.equal(calls[0].body.reasoning_effort, 'low');
  } finally {
    await srv.close();
  }
});

test('image usa /images/edits com referência e cai para /images/generations se a edição falhar', async () => {
  const png = await logoPng();
  const seen = [];
  const srv = await listen(async (req, res) => {
    const raw = await readBody(req);
    seen.push({ path: req.url, type: req.headers['content-type'], raw });
    if (req.url === '/v1/images/edits') {
      res.writeHead(400).end('{"error":"edits not supported"}');
      return;
    }
    const body = JSON.parse(raw.toString());
    assert.equal(body.model, 'openai/gpt-image-2');
    assert.equal(body.response_format, 'b64_json');
    res.writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
  });
  try {
    const out = await makeProvider(srv.url).image({ prompt: 'logo', refs: [{ buffer: png }] });
    assert.ok(out.equals(png));
    assert.deepEqual(seen.map((s) => s.path), ['/v1/images/edits', '/v1/images/generations']);
    assert.match(seen[0].type, /^multipart\/form-data/);
    assert.match(seen[0].raw.toString('latin1'), /name="image"; filename="ref-0.png"/);
  } finally {
    await srv.close();
  }
});

test('image aceita resposta com URL e troca de modelo quando falta saldo (402)', async () => {
  const png = await logoPng();
  const models = [];
  const srv = await listen(async (req, res) => {
    if (req.url === '/file.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' }).end(png);
      return;
    }
    const body = JSON.parse((await readBody(req)).toString());
    models.push(body.model);
    if (body.model === 'openai/gpt-image-2') {
      res.writeHead(402).end('{"error":"insufficient balance"}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ data: [{ url: `http://${req.headers.host}/file.png` }] }));
  });
  try {
    const out = await makeProvider(srv.url).image({ prompt: 'logo' });
    assert.ok(out.equals(png));
    assert.deepEqual(models, ['openai/gpt-image-2', 'openai/gpt-image-1.5']);
  } finally {
    await srv.close();
  }
});

test('chave inválida (401) é erro fatal: não tenta outros modelos', async () => {
  let hits = 0;
  const srv = await listen((_req, res) => { hits += 1; res.writeHead(401).end('{"error":"bad key"}'); });
  try {
    await assert.rejects(makeProvider(srv.url).chat({ messages: [] }), (e) => e instanceof ProviderError && e.fatal);
    assert.equal(hits, 1);
  } finally {
    await srv.close();
  }
});
