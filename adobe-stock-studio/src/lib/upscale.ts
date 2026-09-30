import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { log } from './bus';
import { paths } from './paths';
import type { Settings } from './settings';
import { StopError } from './util';

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
      message: 'Real-ESRGAN não instalado. Rode "npm run setup:upscaler" (ou informe o caminho do executável).',
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
      reject(new Error(`Real-ESRGAN saiu com código ${code}: ${stderr.split('\n').filter(Boolean).slice(-3).join(' | ')}`));
    });
  });
}

let warnedMissing = false;

/**
 * Amplia a imagem gerada (≈1–2 MP) para o tamanho ideal do Adobe Stock.
 * 1) Real-ESRGAN x4 (IA, roda local na GPU via Vulkan) → 2) ajuste fino com Lanczos para o
 * lado maior configurado → JPEG sRGB. Sem Real-ESRGAN, usa apenas Lanczos + nitidez leve.
 */
export async function upscaleForAdobe(input: string, outputJpg: string, settings: Settings, signal: AbortSignal): Promise<UpscaleResult> {
  let source = input;
  let method = 'Lanczos (sharp)';
  const tmpPng = outputJpg.replace(/\.jpe?g$/i, '') + '.x4.png';

  if (settings.upscaler === 'realesrgan') {
    const status = realEsrganStatus(settings);
    if (status.available && status.binary) {
      try {
        await runRealEsrgan(status.binary, input, tmpPng, settings.realesrganModel, signal);
        source = tmpPng;
        method = `Real-ESRGAN x4 (${settings.realesrganModel})`;
      } catch (err) {
        if (err instanceof StopError) throw err;
        log.warn(`Real-ESRGAN falhou (${err instanceof Error ? err.message : err}). Usando Lanczos nesta imagem.`);
      }
    } else if (!warnedMissing) {
      warnedMissing = true;
      log.warn(status.message + ' Enquanto isso, a ampliação usa Lanczos.');
    }
  }

  try {
    const meta = await sharp(source, { limitInputPixels: false }).metadata();
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
      let pipeline = sharp(source, { limitInputPixels: false }).resize(width, height, { kernel: 'lanczos3', fit: 'fill' });
      if (source === input) pipeline = pipeline.sharpen({ sigma: 0.6 });
      await pipeline
        .toColorspace('srgb')
        .withIccProfile('srgb')
        .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
        .toFile(outputJpg);
      const sizeBytes = fs.statSync(outputJpg).size;
      if (sizeBytes <= ADOBE_LIMITS.maxBytes || quality <= 75) {
        return { width, height, sizeBytes, method };
      }
      quality -= 5;
    }
  } finally {
    if (source !== input) fs.rmSync(tmpPng, { force: true });
  }
}

/** Miniatura para o painel e para o histórico (fica salva mesmo depois de apagar o original). */
export async function makeThumb(input: string, output: string): Promise<void> {
  await sharp(input).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 78 }).toFile(output);
}
