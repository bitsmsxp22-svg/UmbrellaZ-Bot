#!/usr/bin/env sh
# Mac/Linux: instala (na primeira vez) e abre o Logo Studio em http://localhost:3000
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Instale o Node.js 22+ em https://nodejs.org"; exit 1; }
[ -d node_modules ] || npm install || exit 1
[ -f .env ] || cp .env.example .env
( sleep 4; (command -v open >/dev/null && open http://localhost:3000) || xdg-open http://localhost:3000 ) >/dev/null 2>&1 &
npm run dev
