#!/usr/bin/env bash
# Stock Studio - inicia o sistema no macOS/Linux:  ./iniciar.sh
set -e
cd "$(dirname "$0")"
NODE=node
[ -x runtime/node ] && NODE=runtime/node
command -v "$NODE" >/dev/null || { echo "Instale o Node.js 22 ou mais novo: https://nodejs.org"; exit 1; }
[ -d node_modules ] || { echo "Instalando dependências pela primeira vez..."; npm install; }
[ -f dist/server/entry.mjs ] || { echo "Preparando o painel..."; "$NODE" node_modules/astro/bin/astro.mjs build; }
( sleep 3; (command -v open >/dev/null && open http://127.0.0.1:4321) || (command -v xdg-open >/dev/null && xdg-open http://127.0.0.1:4321) || true ) &
echo "Stock Studio rodando em http://127.0.0.1:4321 (Ctrl+C para desligar)"
exec "$NODE" dist/server/entry.mjs
