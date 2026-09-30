import sharp from 'sharp';
import type { AspectRatio } from './settings';

const SIZES: Record<AspectRatio, [number, number]> = {
  '3:2': [1536, 1024],
  '2:3': [1024, 1536],
  '16:9': [1792, 1008],
  '1:1': [1024, 1024],
  '4:3': [1536, 1152],
};

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Modo simulação: cria uma imagem abstrata local no lugar do ChatGPT, para testar o fluxo
 * completo (ampliação, CSV, log, limpeza) sem usar contas nem gastar limites.
 */
export async function simulatedImage(title: string, ratio: AspectRatio): Promise<Buffer> {
  const [w, h] = SIZES[ratio];
  const hue = Math.floor(Math.random() * 360);
  const circles = Array.from({ length: 14 }, () => {
    const r = 40 + Math.random() * 260;
    const x = Math.random() * w;
    const y = Math.random() * h;
    const c = `hsla(${(hue + Math.random() * 120) % 360}, 70%, ${45 + Math.random() * 30}%, ${0.25 + Math.random() * 0.4})`;
    return `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(0)}" fill="${c}"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue},65%,22%)"/><stop offset="1" stop-color="hsl(${(hue + 70) % 360},70%,55%)"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>${circles}
    <text x="50%" y="46%" text-anchor="middle" font-family="sans-serif" font-size="56" font-weight="700" fill="white" opacity="0.9">SIMULAÇÃO</text>
    <text x="50%" y="56%" text-anchor="middle" font-family="sans-serif" font-size="30" fill="white" opacity="0.85">${esc(title.slice(0, 70))}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
