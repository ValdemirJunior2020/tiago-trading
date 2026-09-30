@echo off
setlocal
title Tiago Bot Forex
cd /d "%~dp0"

where node >nul 2>nul || (
  echo.
  echo [ERRO] Node.js nao encontrado.
  echo Instale Node.js 22+ e tente novamente.
  pause
  exit /b 1
)

echo.
echo ==========================================
echo        TIAGO BOT FOREX - START
echo ==========================================
echo.

echo [1/4] Instalando/verificando dependencias...
call npm install
if errorlevel 1 goto :fail

if not exist .env (
  echo [2/4] Criando .env a partir do exemplo...
  copy .env.example .env >nul
  echo.
  echo [ATENCAO] Preencha OANDA_ACCOUNT_ID e OANDA_API_TOKEN no .env.
  echo Depois execute START.bat novamente.
  pause
  exit /b 0
) else (
  echo [2/4] .env encontrado.
)

echo [3/4] Verificando build e testes...
call npm run verify
if errorlevel 1 goto :fail

where ollama >nul 2>nul
if not errorlevel 1 (
  curl -s http://127.0.0.1:11434/api/tags >nul 2>nul
  if errorlevel 1 (
    echo Iniciando Ollama...
    start "" /min ollama serve
    timeout /t 2 /nobreak >nul
  )
)

echo [4/4] Iniciando servidor e dashboard...
start "Tiago Bot Forex" cmd /k "npm run dev"
timeout /t 5 /nobreak >nul
start "" http://127.0.0.1:8790/health
start "" http://127.0.0.1:5173
exit /b 0

:fail
echo.
echo ==========================================
echo [ERRO] O projeto nao passou na verificacao.
echo Nao inicie trading ate corrigir o erro acima.
echo ==========================================
pause
exit /b 1
