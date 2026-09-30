@echo off
REM Stock Studio - inicia o sistema no Windows (duplo clique).
cd /d "%~dp0"
where node >nul 2>nul || (echo Instale o Node.js 22 ou mais novo: https://nodejs.org & pause & exit /b 1)
if not exist node_modules (
  echo Instalando dependencias pela primeira vez...
  call npm install || (pause & exit /b 1)
)
echo Preparando o painel...
call npm run build || (pause & exit /b 1)
start "" http://127.0.0.1:4321
echo.
echo Stock Studio rodando em http://127.0.0.1:4321  (feche esta janela para desligar)
node ./dist/server/entry.mjs
pause
