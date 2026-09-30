@echo off
chcp 65001 >nul
title Stock Studio
REM Stock Studio - inicia o sistema no Windows (duplo clique).
cd /d "%~dp0"

REM Pacote em partes: na primeira vez junta as partes 2, 3 e 4 (Node.js portatil e modelo de IA).
if exist "%~dp0montar-pacote.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0montar-pacote.ps1"
  if errorlevel 1 (
    echo.
    echo Nao foi possivel montar o pacote. Veja a mensagem acima.
    pause
    exit /b 1
  )
)

REM Usa o Node.js portatil que vem no pacote (runtime\node.exe); senao, o Node instalado no PC.
set "NODE=node"
if exist "%~dp0runtime\node.exe" set "NODE=%~dp0runtime\node.exe"
"%NODE%" -v >nul 2>nul || (
  echo Node.js nao encontrado. Instale o Node.js 22 em https://nodejs.org e abra de novo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Instalando dependencias pela primeira vez...
  call npm install || (pause & exit /b 1)
)
if not exist "dist\server\entry.mjs" (
  echo Preparando o painel...
  "%NODE%" node_modules\astro\bin\astro.mjs build || (pause & exit /b 1)
)

start "" cmd /c "timeout /t 3 >nul & start http://127.0.0.1:4321"
echo.
echo   Stock Studio rodando em http://127.0.0.1:4321
echo   Deixe esta janela aberta enquanto usa o sistema. Para desligar, feche esta janela.
echo.
"%NODE%" dist\server\entry.mjs
pause
