// Baixa o Real-ESRGAN (versão portátil ncnn-vulkan) para tools/realesrgan.
// Roda na GPU via Vulkan (NVIDIA, AMD, Intel ou Apple) — sem Python, sem CUDA, sem conta.
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';

const RELEASE = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/';
const FILES = {
  win32: 'realesrgan-ncnn-vulkan-20220424-windows.zip',
  linux: 'realesrgan-ncnn-vulkan-20220424-ubuntu.zip',
  darwin: 'realesrgan-ncnn-vulkan-20220424-macos.zip',
};

const file = FILES[process.platform];
if (!file) {
  console.error(`Sistema não suportado: ${process.platform}`);
  process.exit(1);
}

const target = path.resolve('tools', 'realesrgan');
const exe = process.platform === 'win32' ? 'realesrgan-ncnn-vulkan.exe' : 'realesrgan-ncnn-vulkan';

function findExe(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === exe) return full;
    if (entry.isDirectory()) {
      const found = findExe(full);
      if (found) return found;
    }
  }
  return null;
}

if (fs.existsSync(target) && findExe(target)) {
  console.log(`Real-ESRGAN já está instalado em ${target}`);
  process.exit(0);
}

console.log(`Baixando ${RELEASE}${file} …`);
const res = await fetch(RELEASE + file);
if (!res.ok) {
  console.error(`Falha no download (${res.status}). Baixe manualmente em ${RELEASE}${file} e extraia em ${target}`);
  process.exit(1);
}
const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
fs.mkdirSync(target, { recursive: true });
zip.extractAllTo(target, true);

const bin = findExe(target);
if (!bin) {
  console.error('Download concluído, mas o executável não foi encontrado no pacote.');
  process.exit(1);
}
if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);
console.log(`Pronto! Real-ESRGAN instalado em ${bin}`);
console.log('Modelos disponíveis:', fs.readdirSync(path.join(path.dirname(bin), 'models')).filter((f) => f.endsWith('.param')).join(', '));
