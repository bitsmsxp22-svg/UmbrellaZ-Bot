import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';

// Dados de teste isolados (não mexe em data/ do projeto).
process.env.STOCK_STUDIO_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-studio-test-'));

const { buildAdobeCsv } = await import('../src/lib/csv');
const { sanitizeKeywords, sanitizeTitle, sanitizePrompt, normalizeCategory } = await import('../src/lib/metadata');
const { classifyCategory } = await import('../src/lib/categories');
const { computeTerms, rankWeight, contentTokens } = await import('../src/lib/trends');
const { extractJsonArray, developConcepts } = await import('../src/lib/prompts');
const { upcomingSeasonal } = await import('../src/lib/seasonal');
const { normalizeSettings, DEFAULT_SETTINGS } = await import('../src/lib/settings');
const { upscaleForAdobe } = await import('../src/lib/upscale');
const { builtinNiche } = await import('../src/lib/builtin-research');
const { buildSnapshot } = await import('../src/lib/trends');

test('CSV segue o formato do Adobe Stock e escapa aspas', () => {
  const csv = buildAdobeCsv([{ filename: 'a.jpg', title: 'Team "meeting"', keywords: ['team', 'office'], category: 3 }]);
  const [header, row] = csv.trim().split('\n');
  assert.equal(header, 'Filename,Title,Keywords,Category,Releases');
  assert.equal(row, '"a.jpg","Team ""meeting""","team, office",3,""');
});

test('palavras-chave: remove marcas, ruído e duplicadas; máximo 49', () => {
  const kws = sanitizeKeywords(['Office', 'office', 'iPhone', 'AI generated', 'team work', '', '123', ...Array.from({ length: 80 }, (_, i) => `kw${i}`)]);
  assert.equal(kws[0], 'office');
  assert.ok(!kws.includes('iphone'));
  assert.ok(!kws.includes('ai generated'));
  assert.ok(!kws.includes('123'));
  assert.equal(new Set(kws).size, kws.length);
  assert.equal(kws.length, 49);
});

test('título segue o Adobe: sem marcas, sem vírgulas, sem "AI generated", até 70 caracteres', () => {
  assert.equal(sanitizeTitle('"business team with Apple laptop" AI generated'), 'Business team with laptop');
  assert.equal(sanitizeTitle('Coffee cup, top view, copy space'), 'Coffee cup top view copy space');
  assert.ok(!/nike/i.test(sanitizePrompt('runner wearing Nike shoes')));
  const long = sanitizeTitle('Diverse group of young business people collaborating around a bright wooden desk in a modern office');
  assert.ok(long.length <= 70, long);
  assert.ok(!/\s(with|and|of|in|a)$/i.test(long), long);
});

test('título: Title Case vira frase, sem " - ", e o corte não deixa pedaço solto', () => {
  assert.equal(
    sanitizeTitle('Thanksgiving - Pumpkins On Rustic Table With Candles And String Lights'),
    'Thanksgiving pumpkins on rustic table with candles and string lights',
  );
  const cut = sanitizeTitle('Black torn paper isolated on white background Copy space for black text and more words here');
  assert.ok(cut.length <= 70, cut);
  assert.ok(!/\s(for|with|and)(\s\w+)?$/i.test(cut), cut);
  assert.equal(sanitizeTitle('Cute muzzle of a black cat close up flat lay top view'), 'Cute muzzle of a black cat close up flat lay top view');
  assert.equal(sanitizeTitle('Business Team Meeting In Modern NYC Office Space'), 'Business team meeting in modern NYC office space');
});

test('miniatura redimensionada: acha o endereço do original', async () => {
  const { unwrapResizedUrl } = await import('../src/lib/providers/web-helpers');
  const page = 'https://site.test/gerar';
  assert.deepEqual(unwrapResizedUrl('/_next/image?url=%2Fuploads%2Fa.png&w=750&q=75', page), ['https://site.test/uploads/a.png', 'https://site.test/_next/image?url=%2Fuploads%2Fa.png']);
  assert.ok(unwrapResizedUrl('https://cdn.test/cdn-cgi/image/width=760,quality=80/img/b.webp', page).includes('https://cdn.test/img/b.webp'));
  assert.deepEqual(unwrapResizedUrl('https://cdn.test/c.jpg?w=760&token=x', page), ['https://cdn.test/c.jpg?token=x']);
  assert.deepEqual(unwrapResizedUrl('https://cdn.test/d.jpg', page), []);
});

test('categoria: nicho pesa e valores inválidos são reclassificados', () => {
  assert.equal(classifyCategory('halloween halloween witch hat and cauldron'), 15);
  assert.equal(classifyCategory('business teamwork office meeting'), 3);
  assert.equal(normalizeCategory(19, 'food'), 19);
  assert.equal(normalizeCategory('abc', 'fresh salad food'), 7);
  assert.equal(normalizeCategory(null, 'xyz', 12), 12);
});

test('ranking de termos: 1º lugar pesa mais e bigramas precisam se repetir', () => {
  assert.ok(rankWeight(1) > rankWeight(10));
  const items = [
    { rank: 1, id: '1', title: 'Solar panels on a roof at sunset', url: '', keywords: [] },
    { rank: 2, id: '2', title: 'Engineer checking solar panels', url: '', keywords: [] },
    { rank: 3, id: '3', title: 'Wind turbine field', url: '', keywords: [] },
  ];
  const terms = computeTerms(items).map((t) => t.term);
  assert.equal(terms[0], 'solar');
  assert.ok(terms.includes('solar panels'));
  assert.ok(!terms.includes('roof sunset'));
  assert.deepEqual(contentTokens('Team with a laptop and coffee'), ['team', 'laptop', 'coffee']);
});

test('extrai JSON da resposta do ChatGPT mesmo com texto em volta', () => {
  const text = 'json\nCopy code\n```json\n[{"brief":1,"prompt":"p [x]","title":"t","keywords":["a"],"category":3}]\n```\nPronto!';
  const arr = extractJsonArray(text);
  assert.ok(arr);
  assert.equal((arr![0] as { brief: number }).brief, 1);
  assert.equal(extractJsonArray('sem json aqui'), null);
  // Página inteira de um chat: pega o último array válido (a resposta), ignorando texto com colchetes.
  const page = 'Você: crie [3] prompts\nAssistente:\n[{"brief":1,"title":"a"},{"brief":2,"title":"b"}] fim [nota]';
  assert.equal(extractJsonArray(page)?.length, 2);
});

test('nome de arquivo do lote tem no máximo 30 caracteres (regra do CSV do Adobe) e é único', async () => {
  const { createBatch } = await import('../src/lib/batch');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-'));
  const concept = { prompt: 'p', title: 'Extraordinarily long business teamwork title', keywords: ['a'], category: 3, niche: 'n', inspiration: 'i', inspirationRank: 1, engine: 'local' as const };
  const batch = await createBatch(dir, [concept, concept, concept]);
  for (const item of batch.items) assert.ok(item.filename.length <= 30, item.filename);
  assert.equal(new Set(batch.items.map((i) => i.filename)).size, 3);
});

test('datas sazonais: em 30/09/2026 aparecem Halloween e Thanksgiving (26/11)', () => {
  const events = upcomingSeasonal(new Date(2026, 8, 30));
  const names = events.map((e) => e.query);
  assert.ok(names.includes('halloween'));
  const thanks = events.find((e) => e.query === 'thanksgiving dinner');
  assert.equal(thanks?.date.getDate(), 26);
  assert.ok(events.every((e) => e.daysAhead >= 15 && e.daysAhead <= 100));
});

test('configurações: valores fora do limite são corrigidos', () => {
  const s = normalizeSettings({ imagesPerBatch: 999, jpegQuality: 10, promptEngine: 'x', niches: 'a\n\nb' });
  assert.equal(s.imagesPerBatch, 50);
  assert.equal(s.jpegQuality, 70);
  assert.equal(s.promptEngine, DEFAULT_SETTINGS.promptEngine);
  assert.deepEqual(s.niches, ['a', 'b']);
});

test('gerador local: prompts sem repetição, título e palavras-chave limpos', async () => {
  const niches = ['halloween', 'business teamwork office'].map((q) => builtinNiche(q));
  const snapshot = buildSnapshot(niches, 'test');
  const concepts = await developConcepts(snapshot, 4, normalizeSettings({ promptEngine: 'local' }), null);
  assert.equal(concepts.length, 4);
  assert.equal(new Set(concepts.map((c) => c.prompt)).size, 4);
  for (const c of concepts) {
    assert.ok(c.keywords.length >= 5 && c.keywords.length <= 49);
    assert.ok(!c.keywords.some((k) => ['and', 'with', 'the'].includes(k)), c.keywords.join(','));
    assert.ok(c.prompt.includes('No text'));
    assert.ok(c.category >= 1 && c.category <= 21);
  }
  assert.equal(concepts.find((c) => c.niche === 'halloween')?.category, 15);
});

test('ampliação: gera JPEG sRGB com pelo menos 4 MP no lado alvo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upscale-'));
  const input = path.join(dir, 'in.png');
  await sharp({ create: { width: 1536, height: 1024, channels: 3, background: '#336699' } }).png().toFile(input);
  const out = path.join(dir, 'out.jpg');
  const settings = normalizeSettings({ upscaler: 'sharp', targetLongSide: 6000 });
  const r = await upscaleForAdobe(input, out, settings, new AbortController().signal);
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 6000);
  assert.equal(meta.height, 4000);
  assert.ok((r.width * r.height) / 1e6 >= 4);
  assert.equal(meta.space, 'srgb');
});
