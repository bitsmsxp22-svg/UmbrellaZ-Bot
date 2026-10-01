import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { rasterToSvg, svgToPng } from '../src/vectorize.js';
import { sanitizeSvg } from '../src/sanitize.js';
import { logoPng } from './helpers.js';

test('rasterToSvg gera SVG escalável, recortado e sem fundo', async () => {
  const jpeg = await sharp(await logoPng()).jpeg({ quality: 85 }).toBuffer();
  const svg = await rasterToSvg(jpeg, { transparent: true });
  assert.match(svg, /^<svg[^>]+viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /fill="#e[3-7]39[34]\d"/i, 'mantém a cor principal');
  assert.doesNotMatch(svg, /fill="#f[ef]f[ef]f[ef]"/i, 'fundo branco removido');
  assert.doesNotMatch(svg, /<!--|<\?xml|VTracer|vectorizer/i, 'sem assinatura do gerador');
  const [, w, h] = svg.match(/viewBox="0 0 (\d+) (\d+)"/).map(Number);
  assert.ok(w < 2048 * 0.8 && h < 2048 * 0.8, `recortado ao conteúdo (${w}x${h})`);

  const png = await svgToPng(svg, 512);
  const meta = await sharp(png).metadata();
  assert.equal(meta.hasAlpha, true);
  assert.equal(Math.max(meta.width, meta.height), 512);
  const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  assert.equal(data[3], 0, 'canto do PNG é transparente');
});

test('rasterToSvg com fundo mantém a cor de fundo', async () => {
  const svg = await rasterToSvg(await logoPng('#F4E1C1'), { transparent: false });
  assert.match(svg, /fill="#f[345]e[0-2]c[0-2]"/i);
});

test('sanitizeSvg remove scripts, eventos e links externos', () => {
  const dirty = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)">
    <script>alert(2)</script><foreignObject><div>x</div></foreignObject>
    <a href="https://evil.example"><circle r="5" fill="red"/></a>
    <image href="https://evil.example/x.png"/><rect width="5" height="5" fill="#123456" style="fill:url(https://evil.example)"/></svg>`;
  const clean = sanitizeSvg(dirty);
  assert.doesNotMatch(clean, /script|onload|foreignObject|evil\.example|<image|style=/i);
  assert.match(clean, /<rect[^>]*fill="#123456"/);
  assert.throws(() => sanitizeSvg('<div>não é svg</div>'));
});

test('tons claros legítimos (texto azul-claro sobre branco) não são confundidos com anti-aliasing', async () => {
  const jpeg = await sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#FFFFFF"/>
     <circle cx="256" cy="180" r="90" fill="#0077B6"/>
     <text x="256" y="400" font-family="DejaVu Sans, Arial" font-weight="bold" font-size="64" text-anchor="middle" fill="#90E0EF">Marca</text></svg>`,
  )).jpeg({ quality: 90 }).toBuffer();
  for (const transparent of [true, false]) {
    const svg = await rasterToSvg(jpeg, { transparent });
    assert.match(svg, /fill="#9[0-7]d[c-f]e[c-f]"/i, `texto claro preservado (transparent=${transparent})`);
    const colors = new Set([...svg.matchAll(/fill="(#[0-9a-f]+)"/gi)].map((m) => m[1].toLowerCase()));
    assert.ok(colors.size <= (transparent ? 2 : 3), `sem cores de borda extras: ${[...colors]}`);
  }
});
