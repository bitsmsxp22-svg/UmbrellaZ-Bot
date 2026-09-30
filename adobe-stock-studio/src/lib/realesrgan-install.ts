import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths';

/**
 * Instala o Real-ESRGAN (versão portátil ncnn-vulkan) em tools/realesrgan.
 * Roda na GPU via Vulkan (NVIDIA, AMD, Intel ou Apple) — sem Python, sem CUDA, sem conta.
 */
const RELEASE = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/';
const FILES: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'realesrgan-ncnn-vulkan-20220424-windows.zip',
  linux: 'realesrgan-ncnn-vulkan-20220424-ubuntu.zip',
  darwin: 'realesrgan-ncnn-vulkan-20220424-macos.zip',
};
const EXE = process.platform === 'win32' ? 'realesrgan-ncnn-vulkan.exe' : 'realesrgan-ncnn-vulkan';

function findExe(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === EXE) return full;
    if (entry.isDirectory()) {
      const found = findExe(full);
      if (found) return found;
    }
  }
  return null;
}

export async function installRealEsrgan(log: (msg: string) => void = console.log): Promise<string> {
  const existing = findExe(paths.realesrgan);
  if (existing) return existing;
  const file = FILES[process.platform];
  if (!file) throw new Error(`sistema não suportado pelo Real-ESRGAN portátil: ${process.platform}`);

  log(`Baixando o Real-ESRGAN (${file}, ~45 MB)…`);
  const res = await fetch(RELEASE + file);
  if (!res.ok) throw new Error(`download falhou (HTTP ${res.status}). Baixe ${RELEASE + file} e extraia em ${paths.realesrgan}`);
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  fs.mkdirSync(paths.realesrgan, { recursive: true });
  zip.extractAllTo(paths.realesrgan, true);

  const bin = findExe(paths.realesrgan);
  if (!bin) throw new Error('download concluído, mas o executável não veio no pacote');
  if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);
  log(`Real-ESRGAN instalado em ${bin}`);
  return bin;
}
