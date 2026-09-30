import sharp from 'sharp';
import { sleep } from './http.js';

/**
 * Provedor de teste (sem internet, sem chave). Simula o GPT-5.6 Sol e o GPT Image 2
 * para validar a interface e todo o pipeline raster -> SVG localmente.
 */
const PALETTES = [
  ['#1D3557', '#E63946'],
  ['#2A9D8F', '#264653'],
  ['#6A4C93', '#FFCA3A'],
  ['#111111', '#FF6B35'],
  ['#0077B6', '#90E0EF'],
  ['#3A5A40', '#DDA15E'],
  ['#9D0208', '#F48C06'],
  ['#22223B', '#C9ADA7'],
];

const esc = (s) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

function drawLogo(index, brand) {
  const [a, b] = PALETTES[index % PALETTES.length];
  const name = esc((brand || 'Marca').slice(0, 14));
  const initials = esc((brand || 'M').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase());
  const text = (y, size, color, extra = '') =>
    `<text x="512" y="${y}" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="${size}" text-anchor="middle" fill="${color}" ${extra}>${name}</text>`;
  const shapes = [
    `<circle cx="512" cy="380" r="170" fill="${a}"/><polygon points="512,260 620,470 404,470" fill="${b}"/>${text(760, 110, a)}`,
    `<rect x="332" y="232" width="360" height="360" rx="80" fill="${a}"/><text x="512" y="480" font-family="DejaVu Sans, Arial" font-weight="bold" font-size="200" text-anchor="middle" fill="${b}">${initials}</text>${text(780, 90, a)}`,
    `<circle cx="512" cy="512" r="330" fill="${a}"/><circle cx="512" cy="512" r="290" fill="none" stroke="${b}" stroke-width="16"/>${text(545, 96, b)}<path d="M392 380 L512 300 L632 380 Z" fill="${b}"/>`,
    `${text(560, 150, a, 'letter-spacing="4"')}<rect x="232" y="610" width="560" height="22" fill="${b}"/>`,
    `<path d="M512 200 C650 200 700 330 640 420 C590 500 434 500 384 420 C324 330 374 200 512 200 Z" fill="${a}"/><circle cx="512" cy="330" r="60" fill="#FFFFFF"/>${text(720, 100, b)}`,
    `<circle cx="512" cy="380" r="160" fill="none" stroke="${a}" stroke-width="20"/><path d="M420 400 Q512 260 604 400" fill="none" stroke="${b}" stroke-width="20"/>${text(740, 96, a)}`,
    `<rect x="312" y="230" width="180" height="300" fill="${a}"/><rect x="532" y="230" width="180" height="300" fill="${b}"/>${text(740, 110, a)}`,
    `<path d="M512 220 L600 400 L512 520 L424 400 Z" fill="${b}"/>${text(720, 100, a)}`,
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#FFFFFF"/>${shapes[index % shapes.length]}</svg>`;
}

export class MockProvider {
  constructor({ delayMs = 600 } = {}) {
    this.delayMs = delayMs;
    this.imageCount = 0;
  }

  async chat({ messages, json, signal }) {
    await sleep(this.delayMs, signal);
    const user = messages.find((m) => m.role === 'user');
    const text = Array.isArray(user.content) ? user.content.map((c) => c.text || '').join('\n') : user.content;
    if (!json) {
      return drawLogo(this.imageCount++, 'SVG').replace(/<rect width="1024" height="1024" fill="#FFFFFF"\/>/, '');
    }
    const brief = (text.match(/"""([\s\S]*?)"""/) || [, ''])[1];
    const n = Number((text.match(/N = (\d+)/) || [, 5])[1]);
    const quoted = brief.match(/["“”']([^"“”']{2,40})["“”']/);
    const brand = quoted ? quoted[1] : brief.split(/\s+/).slice(0, 2).join(' ');
    return JSON.stringify({
      brand,
      concepts: Array.from({ length: n }, (_, i) => ({
        title: ['Símbolo + nome', 'Monograma', 'Emblema', 'Tipográfico', 'Ícone abstrato', 'Linha contínua', 'Moderno bold', 'Clássico'][i],
        description: 'Amostra de teste gerada pelo provedor simulado (sem IA real).',
        palette: PALETTES[i % PALETTES.length],
        image_prompt: `MOCK#${i} ${brand}`,
      })),
    });
  }

  async image({ prompt, signal }) {
    await sleep(this.delayMs * 2, signal);
    const m = prompt.match(/MOCK#(\d+) ([^\n]*)/);
    const index = m ? Number(m[1]) : this.imageCount++;
    const brandMatch = prompt.match(/spelled exactly "([^"]*)"/);
    const svg = drawLogo(index, brandMatch ? brandMatch[1] : (m ? m[2] : 'Marca'));
    // JPEG simula a saída "real" (anti-aliasing + artefatos de compressão).
    return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
  }
}
