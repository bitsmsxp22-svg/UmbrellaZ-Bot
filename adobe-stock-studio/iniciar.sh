#!/usr/bin/env bash
# Stock Studio - inicia o sistema no macOS/Linux:  ./iniciar.sh
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Instale o Node.js 22 ou mais novo: https://nodejs.org"; exit 1; }
[ -d node_modules ] || { echo "Instalando dependências pela primeira vez..."; npm install; }
echo "Preparando o painel..."
npm run build
( sleep 2; (command -v open >/dev/null && open http://127.0.0.1:4321) || (command -v xdg-open >/dev/null && xdg-open http://127.0.0.1:4321) || true ) &
echo "Stock Studio rodando em http://127.0.0.1:4321 (Ctrl+C para desligar)"
exec node ./dist/server/entry.mjs
