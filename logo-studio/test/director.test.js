import assert from 'node:assert/strict';
import test from 'node:test';
import { buildImagePrompt, createConcepts, extractJson, guessBrand } from '../src/director.js';

test('extractJson aceita blocos de código e texto extra', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Aqui está: {"b":[1,2]} fim'), { b: [1, 2] });
  assert.throws(() => extractJson('sem json'));
});

test('guessBrand encontra o nome entre aspas ou após "chamada"', () => {
  assert.equal(guessBrand('Logo para cafeteria "Grão Nobre" moderna'), 'Grão Nobre');
  assert.equal(guessBrand('uma pet shop chamada Patas Felizes, cores azul'), 'Patas Felizes');
  assert.equal(guessBrand('algo minimalista'), '');
});

test('createConcepts completa conceitos inválidos e usa fallback local se o modelo falhar', async () => {
  const partial = {
    chat: async () => JSON.stringify({
      brand: 'Acme',
      concepts: [{ title: 'Um', description: 'd', palette: ['#112233', 'azul'], image_prompt: 'A red fox symbol with "Acme"' }, { title: 'ruim' }],
    }),
  };
  const r = await createConcepts(partial, { brief: 'logo "Acme"', n: 5 });
  assert.equal(r.brand, 'Acme');
  assert.equal(r.concepts.length, 5);
  assert.deepEqual(r.concepts[0].palette, ['#112233']);
  assert.match(r.concepts[1].image_prompt, /Client brief: logo "Acme"/);
  assert.deepEqual(new Set(r.concepts.map((c) => c.direction)).size, 5);

  const broken = { chat: async () => { throw new Error('fora do ar'); } };
  const f = await createConcepts(broken, { brief: 'padaria chamada Pão Real', n: 5 });
  assert.equal(f.brand, 'Pão Real');
  assert.equal(f.concepts.length, 5);
});

test('buildImagePrompt força estilo vetorial e o texto exato da marca', () => {
  const p = buildImagePrompt({ image_prompt: 'A lion head' }, { brand: 'Leão', transparent: true });
  assert.match(p, /Flat vector artwork/);
  assert.match(p, /transparent background/);
  assert.match(p, /exactly "Leão"/);
  assert.match(buildImagePrompt({ image_prompt: 'x'.repeat(20) }, { brand: '', transparent: false }), /pure white background/);
});
