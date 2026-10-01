@echo off
title Logo Studio
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js 22 ou mais novo em https://nodejs.org e abra este arquivo de novo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando dependencias, aguarde... (so na primeira vez^)
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
if not exist .env copy .env.example .env >nul
start "" cmd /c "timeout /t 4 >nul & start http://localhost:3000"
echo Logo Studio rodando em http://localhost:3000  -  feche esta janela para parar.
call npm run dev
pause
