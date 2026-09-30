#!/usr/bin/env bash
# Gera o pacote completo para Windows 64 bits, em 4 partes de no máximo ~30 MB cada:
#   StockStudio-parte-1.zip  painel compilado + dependências de Windows + Real-ESRGAN (exe/dll)
#   StockStudio-parte-2.zip  Node.js portátil (metade 1)
#   StockStudio-parte-3.zip  Node.js portátil (metade 2)
#   StockStudio-parte-4.zip  modelo de IA realesrgan-x4plus
# O iniciar.bat junta as partes sozinho na primeira vez (scripts/montar-pacote.ps1).
# Uso (Linux, com GNU split):  scripts/empacotar-windows.sh <pasta-de-saída>
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$(realpath -m "${1:-pacote-windows}")"
WORK="$OUT/work"
ST="$WORK/StockStudio"
rm -rf "$WORK" "$OUT"/StockStudio-parte-*.zip
mkdir -p "$ST"

echo "==> Compilando o painel"
npm run build >/dev/null

echo "==> Copiando arquivos do projeto"
git ls-files -z | tar --null -T - -c | tar -x -C "$ST"
cp -r dist "$ST/"
cp scripts/montar-pacote.ps1 "$ST/"
cp scripts/COMO-USAR-windows.txt "$ST/COMO USAR.txt"

echo "==> Instalando dependências de Windows (x64)"
(cd "$ST" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --omit=dev --os=win32 --cpu=x64 --ignore-scripts >/dev/null)
grep -rhoE "(from|import)\s*\(?\s*['\"][^'\"./][^'\"]*['\"]" dist/server \
  | sed -E "s/.*['\"]([^'\"]+)['\"].*/\1/" | grep -v '^node:' | grep -v '\$' \
  | sed -E 's#^(@[^/]+/[^/]+|[^@/][^/]*).*#\1#' | sort -u > "$WORK/raizes.txt"
node scripts/podar-dependencias.cjs "$ST" "$WORK/raizes.txt"

echo "==> Node.js portátil (v22 LTS) com verificação SHA-256"
mkdir -p "$ST/runtime"
curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$WORK/SHASUMS256.txt"
curl -fsSL https://nodejs.org/dist/latest-v22.x/win-x64/node.exe -o "$ST/runtime/node.exe"
EXPECTED=$(grep ' win-x64/node.exe$' "$WORK/SHASUMS256.txt" | awk '{print $1}')
ACTUAL=$(sha256sum "$ST/runtime/node.exe" | awk '{print $1}')
[ "$EXPECTED" = "$ACTUAL" ] || { echo "SHA-256 do node.exe não confere"; exit 1; }
grep -oE 'node-v22\.[0-9]+\.[0-9]+' "$WORK/SHASUMS256.txt" | head -1 > "$ST/runtime/VERSAO-NODE.txt"
printf '%s' "$ACTUAL" > "$ST/runtime/node.exe.sha256"
(cd "$ST/runtime" && split -n 2 -d -a 3 --numeric-suffixes=1 node.exe node.exe. && rm node.exe)

echo "==> Real-ESRGAN para Windows"
curl -fsSL https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip -o "$WORK/realesrgan.zip"
mkdir -p "$ST/tools/realesrgan"
unzip -q -o "$WORK/realesrgan.zip" -d "$ST/tools/realesrgan"
rm -f "$ST"/tools/realesrgan/{input.jpg,input2.jpg,onepiece_demo.mp4} "$ST"/tools/realesrgan/models/{realesrgan-x4plus-anime,realesr-animevideov3}*
MODEL="$ST/tools/realesrgan/models/realesrgan-x4plus.bin"
printf '%s' "$(sha256sum "$MODEL" | awk '{print $1}')" > "$MODEL.sha256"

echo "==> Compactando as 4 partes"
cd "$WORK"
zip -qr -9 "$OUT/StockStudio-parte-1.zip" StockStudio -x "StockStudio/runtime/node.exe.0*" "StockStudio/tools/realesrgan/models/realesrgan-x4plus.bin"
zip -q -9 "$OUT/StockStudio-parte-2.zip" StockStudio/runtime/node.exe.001
zip -q -9 "$OUT/StockStudio-parte-3.zip" StockStudio/runtime/node.exe.002
zip -q -9 "$OUT/StockStudio-parte-4.zip" StockStudio/tools/realesrgan/models/realesrgan-x4plus.bin
rm -rf "$WORK"
ls -l "$OUT"/StockStudio-parte-*.zip | awk '{printf "%-24s %5.1f MiB\n", substr($9, length($9)-22), $5/1048576}'
