import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { log } from './bus';
import { paths } from './paths';
import type { Settings } from './settings';
import { StopError, removeQuiet } from './util';

// No Windows o cache da libvips mantém os arquivos abertos e impede apagá-los (EBUSY).
// Sem cache + leitura para a memória, nenhum arquivo fica preso.
sharp.cache(false);

/** Exigências do Adobe Stock para fotos/ilustrações rasterizadas. */
export const ADOBE_LIMITS = {
  minMegapixels: 4,
  maxMegapixels: 100,
  maxBytes: 45 * 1024 * 1024,
};

export interface UpscaleResult {
  width: number;
  height: number;
  sizeBytes: number;
  method: string;
}

export interface UpscalerStatus {
  available: boolean;
  binary: string | null;
  models: string[];
  message: string;
}

const EXE = process.platform === 'win32' ? 'realesrgan-ncnn-vulkan.exe' : 'realesrgan-ncnn-vulkan';

function findBinary(dir: string, depth = 3): string | null {
  try {
    const stat = fs.statSync(dir);
    if (stat.isFile()) return path.basename(dir).startsWith('realesrgan-ncnn-vulkan') ? dir : null;
    const direct = path.join(dir, EXE);
    if (fs.existsSync(direct)) return direct;
    if (depth <= 0) return null;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const found = findBinary(path.join(dir, entry.name), depth - 1);
        if (found) return found;
      }
    }
  } catch {
    /* pasta inexistente */
  }
  return null;
}

export function realEsrganStatus(settings: Settings): UpscalerStatus {
  const binary = (settings.realesrganPath && findBinary(settings.realesrganPath)) || findBinary(paths.realesrgan);
  if (!binary) {
    return {
      available: false,
      binary: null,
      models: [],
      message: 'Real-ESRGAN ainda não instalado — ele é baixado automaticamente ao ligar a produção (ou pelo botão "Instalar Real-ESRGAN").',
    };
  }
  const modelsDir = path.join(path.dirname(binary), 'models');
  const models = fs.existsSync(modelsDir)
    ? [...new Set(fs.readdirSync(modelsDir).filter((f) => f.endsWith('.param')).map((f) => f.replace(/\.param$/, '')))]
    : [];
  return {
    available: true,
    binary,
    models,
    message: models.includes(settings.realesrganModel)
      ? `Real-ESRGAN pronto (${settings.realesrganModel}).`
      : `Real-ESRGAN encontrado, mas o modelo "${settings.realesrganModel}" não existe. Disponíveis: ${models.join(', ') || 'nenhum'}.`,
  };
}

function runRealEsrgan(binary: string, input: string, output: string, model: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['-i', input, '-o', output, '-n', model, '-s', '4', '-f', 'png', '-m', path.join(path.dirname(binary), 'models')];
    const child = spawn(binary, args, { cwd: path.dirname(binary), windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr = (stderr + d.toString()).slice(-2000)));
    const timer = setTimeout(() => child.kill(), 15 * 60_000);
    const onAbort = () => child.kill();
    signal.addEventListener('abort', onAbort, { once: true });
    child.on('error', (err) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted) return reject(new StopError());
      if (code === 0 && fs.existsSync(output)) return resolve();
      const detail = stderr.split('\n').filter(Boolean).slice(-3).join(' | ');
      const hint = /vkCreateInstance|invalid gpu|vulkan/i.test(detail)
        ? ' — placa de vídeo com Vulkan não encontrada: atualize o driver de vídeo (NVIDIA/AMD/Intel) e tente de novo'
        : '';
      reject(new Error(`Real-ESRGAN saiu com código ${code}: ${detail}${hint}`));
    });
  });
}

/**
 * Amplia a imagem gerada (≈1–2 MP) para o tamanho ideal do Adobe Stock com IA:
 * Real-ESRGAN x4 (roda local na GPU via Vulkan) → ajuste fino para o lado maior configurado → JPEG sRGB.
 * Se o Real-ESRGAN falhar, a imagem falha — ampliação sem IA (Lanczos) só existe no modo simulação.
 */
export async function upscaleForAdobe(input: string, outputJpg: string, settings: Settings, signal: AbortSignal): Promise<UpscaleResult> {
  let source = input;
  let method = 'Lanczos (sem IA)';
  const tmpPng = outputJpg.replace(/\.jpe?g$/i, '') + '.x4.png';
  const lanczosAllowed = settings.upscaler === 'sharp' || settings.simulationMode;

  if (settings.upscaler === 'realesrgan') {
    const status = realEsrganStatus(settings);
    try {
      if (!status.available || !status.binary) throw new Error(status.message);
      await runRealEsrgan(status.binary, input, tmpPng, settings.realesrganModel, signal);
      source = tmpPng;
      method = `Real-ESRGAN x4 (${settings.realesrganModel})`;
    } catch (err) {
      if (err instanceof StopError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!lanczosAllowed) throw new Error(`ampliação com IA falhou: ${msg}`);
      log.warn(`Real-ESRGAN indisponível (${msg}). Modo simulação: usando Lanczos só para o teste.`);
    }
  }

  try {
    const data = await fs.promises.readFile(source);
    const meta = await sharp(data, { limitInputPixels: false }).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) throw new Error('imagem inválida');

    // Lado maior = alvo configurado, respeitando o máximo de 100 MP.
    let scale = settings.targetLongSide / Math.max(w, h);
    const maxScale = Math.sqrt((ADOBE_LIMITS.maxMegapixels * 1e6 * 0.98) / (w * h));
    scale = Math.min(scale, maxScale);
    const width = Math.round(w * scale);
    const height = Math.round(h * scale);
    if ((width * height) / 1e6 < ADOBE_LIMITS.minMegapixels) {
      throw new Error(`resultado com ${((width * height) / 1e6).toFixed(1)} MP — o Adobe exige no mínimo 4 MP`);
    }

    let quality = settings.jpegQuality;
    for (;;) {
      let pipeline = sharp(data, { limitInputPixels: false }).resize(width, height, { kernel: 'lanczos3', fit: 'fill' });
      if (source === input) pipeline = pipeline.sharpen({ sigma: 0.6 });
      const jpg = await pipeline
        .toColorspace('srgb')
        .withIccProfile('srgb')
        .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
        .toBuffer();
      if (jpg.length <= ADOBE_LIMITS.maxBytes || quality <= 75) {
        await fs.promises.writeFile(outputJpg, jpg);
        return { width, height, sizeBytes: jpg.length, method };
      }
      quality -= 5;
    }
  } finally {
    if (source !== input) await removeQuiet(tmpPng);
  }
}

/** Autoteste rápido (imagem 64×64): confirma que a IA de ampliação roda nesta máquina antes de produzir. */
export async function selfTestRealEsrgan(settings: Settings, signal: AbortSignal): Promise<void> {
  const status = realEsrganStatus(settings);
  if (!status.available || !status.binary) throw new Error(status.message);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realesrgan-teste-'));
  try {
    const input = path.join(dir, 'in.png');
    await sharp({ create: { width: 64, height: 64, channels: 3, background: '#808080' } }).png().toFile(input);
    await runRealEsrgan(status.binary, input, path.join(dir, 'out.png'), settings.realesrganModel, signal);
  } finally {
    await removeQuiet(dir, true);
  }
}

/** Miniatura para o painel e para o histórico (fica salva mesmo depois de apagar o original). */
export async function makeThumb(input: Buffer, output: string): Promise<void> {
  const thumb = await sharp(input).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  await fs.promises.writeFile(output, thumb);
}
