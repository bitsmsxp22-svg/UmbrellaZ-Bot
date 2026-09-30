import sharp from 'sharp';
import { log } from './log.js';

const MAX_SIDE = 1024;
const KEY_DIST = 38; // abaixo disso (distância RGB até o fundo) o pixel vira transparente
const PAD_RATIO = 0.06;

let vtracer = null;
try {
  vtracer = await import('@neplex/vectorizer');
} catch (err) {
  log.warn(`vetorizador nativo indisponível (${err.message}); usando fallback em JavaScript`);
}

const dist = (d, i, c) => {
  const dr = d[i] - c[0];
  const dg = d[i + 1] - c[1];
  const db = d[i + 2] - c[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
};
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** Cor de fundo = mediana dos pixels da borda. */
export function detectBackground(data, width, height) {
  const rs = [], gs = [], bs = [];
  let transparent = 0, total = 0;
  const push = (x, y) => {
    const i = (y * width + x) * 4;
    total += 1;
    if (data[i + 3] < 16) { transparent += 1; return; }
    rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
  };
  const step = Math.max(1, Math.floor(Math.min(width, height) / 128));
  for (let x = 0; x < width; x += step) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y += step) { push(0, y); push(width - 1, y); }
  const med = (arr) => (arr.length ? arr.sort((a, b) => a - b)[arr.length >> 1] : 255);
  return { color: [med(rs), med(gs), med(bs)], alreadyTransparent: transparent / total > 0.5 };
}

/** Torna transparentes os pixels próximos da cor de fundo (inclusive "miolos" de letras). */
export function keyBackground(data, bg) {
  for (let i = 0; i < data.length; i += 4) {
    data[i + 3] = dist(data, i, bg) < KEY_DIST ? 0 : 255;
  }
}

/** Projeção de c no segmento a->b: { t, dist² }. */
function onSegment(c, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
  const t = ((c[0] - a[0]) * ab[0] + (c[1] - a[1]) * ab[1] + (c[2] - a[2]) * ab[2]) / len;
  const tc = Math.min(1, Math.max(0, t));
  const p = [a[0] + ab[0] * tc, a[1] + ab[1] * tc, a[2] + ab[2] * tc];
  return { t, dist2: d2(c, p) };
}

/**
 * Reduz a imagem às cores "reais" do logo:
 * 1) k-means sobre histograma de 15 bits, fundindo tons muito próximos;
 * 2) grupos que são mistura de duas cores (anti-aliasing, borda de JPEG) são desfeitos:
 *    mistura = cor no "caminho" entre duas cores puras E formada só por faixas finas (quase sem pixels internos).
 *    Cada pixel desses vai para a cor pura mais próxima ao longo da mistura (ou vira fundo transparente).
 * Resultado: SVG com poucas camadas e sem "lascas" coloridas nas bordas.
 */
export function quantizeColors(data, width, height, {
  bg = null, useAlpha = false, maxColors = 12, mergeDist = 30, mixTol = 42, mixMaxShare = 0.15, mixMaxInterior = 0.45,
} = {}) {
  const bins = new Map();
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (useAlpha && data[i + 3] === 0) continue;
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    let b = bins.get(key);
    if (!b) { b = [0, 0, 0, 0]; bins.set(key, b); }
    b[0] += 1; b[1] += data[i]; b[2] += data[i + 1]; b[3] += data[i + 2];
    total += 1;
  }
  if (!total) return [];
  const points = [...bins.values()].map(([n, r, g, b]) => ({ n, c: [r / n, g / n, b / n] }));
  points.sort((a, b) => b.n - a.n);

  // Sementes: cores mais frequentes e distantes entre si.
  let centers = [];
  for (const p of points) {
    if (centers.length >= maxColors) break;
    if (centers.every((c) => d2(c, p.c) > mergeDist * mergeDist)) centers.push([...p.c]);
  }
  for (let iter = 0; iter < 10; iter += 1) {
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (const p of points) {
      let best = 0, bd = Infinity;
      for (let k = 0; k < centers.length; k += 1) {
        const d = d2(centers[k], p.c);
        if (d < bd) { bd = d; best = k; }
      }
      const a = acc[best];
      a[0] += p.n; a[1] += p.c[0] * p.n; a[2] += p.c[1] * p.n; a[3] += p.c[2] * p.n;
    }
    const next = acc.filter((a) => a[0]).map((a) => Object.assign([a[1] / a[0], a[2] / a[0], a[3] / a[0]], { n: a[0] }));
    next.sort((a, b) => b.n - a.n);
    centers = [];
    for (const c of next) {
      const near = centers.find((m) => d2(m, c) < mergeDist * mergeDist);
      if (!near) { centers.push(c); continue; }
      const n = near.n + c.n;
      for (let j = 0; j < 3; j += 1) near[j] = (near[j] * near.n + c[j] * c.n) / n;
      near.n = n;
    }
  }

  // Rótulo de cada pixel (255 = transparente) e contagem de pixels internos por grupo.
  const NONE = 255;
  const labels = new Uint8Array(width * height).fill(NONE);
  const nearest = new Map();
  const count = new Array(centers.length).fill(0);
  for (let p = 0, i = 0; p < labels.length; p += 1, i += 4) {
    if (useAlpha && data[i + 3] === 0) continue;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    let k = nearest.get(key);
    if (k === undefined) {
      let bd = Infinity;
      for (let j = 0; j < centers.length; j += 1) {
        const d = (centers[j][0] - data[i]) ** 2 + (centers[j][1] - data[i + 1]) ** 2 + (centers[j][2] - data[i + 2]) ** 2;
        if (d < bd) { bd = d; k = j; }
      }
      nearest.set(key, k);
    }
    labels[p] = k;
    count[k] += 1;
  }
  const interior = new Array(centers.length).fill(0);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      const k = labels[p];
      if (k === NONE) continue;
      if (labels[p - 1] === k && labels[p + 1] === k && labels[p - width] === k && labels[p + width] === k
        && labels[p - width - 1] === k && labels[p - width + 1] === k && labels[p + width - 1] === k && labels[p + width + 1] === k) {
        interior[k] += 1;
      }
    }
  }

  // Classifica (maiores primeiro): cor pura ou mistura de duas cores puras (o fundo conta como pura).
  const pure = [];
  const endpoints = bg ? [{ c: bg, bg: true }] : [];
  const resolve = new Array(centers.length);
  centers
    .map((c, k) => ({ c, k }))
    .sort((a, b) => count[b.k] - count[a.k])
    .forEach(({ c, k }) => {
      let best = null;
      const thin = count[k] > 0 && interior[k] / count[k] < mixMaxInterior;
      if (thin && count[k] / total <= mixMaxShare) {
        for (let a = 0; a < endpoints.length; a += 1) {
          for (let b = a + 1; b < endpoints.length; b += 1) {
            const r = onSegment(c, endpoints[a].c, endpoints[b].c);
            if (r.t > 0.04 && r.t < 0.96 && r.dist2 < mixTol * mixTol && (!best || r.dist2 < best.dist2)) {
              best = { a: endpoints[a], b: endpoints[b], dist2: r.dist2 };
            }
          }
        }
      }
      if (best || !count[k]) {
        resolve[k] = best;
      } else {
        const rounded = c.map((v) => Math.round(v));
        const entry = { c: rounded, bg: false };
        pure.push(rounded);
        endpoints.push(entry);
        resolve[k] = entry;
      }
    });

  const cache = new Map();
  for (let p = 0, i = 0; p < labels.length; p += 1, i += 4) {
    const k = labels[p];
    if (k === NONE) continue;
    let out = resolve[k];
    if (out && out.a) {
      const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      const mix = out;
      out = cache.get(key);
      if (out === undefined) {
        out = onSegment([data[i], data[i + 1], data[i + 2]], mix.a.c, mix.b.c).t < 0.5 ? mix.a : mix.b;
        cache.set(key, out);
      }
    }
    if (!out) continue;
    if (out.bg) {
      data[i + 3] = 0;
    } else {
      data[i] = out.c[0]; data[i + 1] = out.c[1]; data[i + 2] = out.c[2];
    }
  }
  return pure;
}

/** Caixa delimitadora do conteúdo (pixels opacos, ou diferentes do fundo). */
export function contentBox(data, width, height, bg, useAlpha) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const on = useAlpha ? data[i + 3] > 0 : dist(data, i, bg) >= KEY_DIST;
      if (on) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function traceNative(png) {
  const { ColorMode, Hierarchical, PathSimplifyMode } = vtracer;
  return vtracer.vectorize(png, {
    colorMode: ColorMode.Color,
    hierarchical: Hierarchical.Stacked,
    filterSpeckle: 6,
    colorPrecision: 8,
    layerDifference: 8,
    mode: PathSimplifyMode.Spline,
    cornerThreshold: 60,
    lengthThreshold: 4,
    maxIterations: 10,
    spliceThreshold: 45,
    pathPrecision: 2,
  });
}

async function traceJs(raw, width, height) {
  const { default: ImageTracer } = await import('imagetracerjs');
  return ImageTracer.imagedataToSVG({ width, height, data: new Uint8ClampedArray(raw) }, {
    numberofcolors: 12, colorquantcycles: 3, pathomit: 12, ltres: 0.5, qtres: 0.5,
    strokewidth: 0, roundcoords: 1, viewbox: true, blurradius: 0, linefilter: true,
  }).replace(/<path[^>]*opacity="0"[^>]*\/>/g, '');
}

const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** O traçador tira médias ao fundir regiões; aqui cada cor volta para a paleta pura do logo. */
export function snapFills(svg, palette, maxDist = 48) {
  if (!palette.length) return svg;
  return svg.replace(/fill="#([0-9a-f]{6}|[0-9a-f]{3})"/gi, (full, h) => {
    const v = h.length === 3 ? h.split('').map((x) => parseInt(x + x, 16)) : [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    let best = null, bd = Infinity;
    for (const c of palette) {
      const d = d2(c, v);
      if (d < bd) { bd = d; best = c; }
    }
    return bd <= maxDist * maxDist ? `fill="${hex(best)}"` : full;
  });
}

/** Limpa o SVG do traçador: remove cabeçalhos/comentários e garante viewBox escalável. */
export async function finalizeSvg(svg, width, height) {
  let out = svg
    .replace(/<\?xml[^>]*\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<desc>[\s\S]*?<\/desc>/g, '')
    .trim();
  if (!/viewBox=/.test(out)) out = out.replace(/<svg\b/, `<svg viewBox="0 0 ${width} ${height}"`);
  if (vtracer?.optimize) {
    try {
      out = await vtracer.optimize(out, { multipass: true });
    } catch (err) {
      log.warn(`otimização de SVG falhou: ${err.message}`);
    }
  }
  if (!/viewBox=/.test(out)) out = out.replace(/<svg\b/, `<svg viewBox="0 0 ${width} ${height}"`);
  return out;
}

/**
 * Converte a imagem gerada (PNG/JPEG/WebP) em SVG vetorial.
 * transparent=true remove o fundo e recorta o logo com margem.
 */
export async function rasterToSvg(input, { transparent = true } = {}) {
  const { data, info } = await sharp(input, { limitInputPixels: 64e6 })
    .rotate()
    .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const { color: bg, alreadyTransparent } = detectBackground(data, width, height);

  let useAlpha = false;
  if (alreadyTransparent) {
    for (let i = 3; i < data.length; i += 4) data[i] = data[i] >= 128 ? 255 : 0;
    useAlpha = true;
  } else if (transparent) {
    keyBackground(data, bg);
    useAlpha = true;
  }

  const palette = quantizeColors(data, width, height, { useAlpha, bg: transparent && !alreadyTransparent ? bg : null });

  const box = contentBox(data, width, height, bg, useAlpha);
  if (!box) throw new Error('imagem sem conteúdo visível');

  const pad = Math.round(Math.max(box.width, box.height) * PAD_RATIO);
  const background = useAlpha ? { r: 0, g: 0, b: 0, alpha: 0 } : { r: bg[0], g: bg[1], b: bg[2], alpha: 1 };
  const cropped = sharp(data, { raw: { width, height, channels: 4 } })
    .extract(box)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background });

  const outW = box.width + pad * 2;
  const outH = box.height + pad * 2;
  let svg;
  if (vtracer) {
    svg = await traceNative(await cropped.png().toBuffer());
  } else {
    svg = await traceJs(await cropped.raw().toBuffer(), outW, outH);
  }
  return finalizeSvg(snapFills(svg, palette), outW, outH);
}

/** PNG de alta resolução renderizado a partir do SVG final (fundo transparente preservado). */
export async function svgToPng(svg, size = 2048) {
  const vb = svg.match(/viewBox="[\d.\s-]*?([\d.]+)\s+([\d.]+)"/);
  const side = vb ? Math.max(Number(vb[1]), Number(vb[2])) : 1024;
  const density = Math.min(2400, Math.max(36, Math.round((72 * size) / side)));
  return sharp(Buffer.from(svg), { density })
    .resize(size, size, { fit: 'inside' })
    .png({ compressionLevel: 9 })
    .toBuffer();
}
