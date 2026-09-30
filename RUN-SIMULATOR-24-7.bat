@echo off
setlocal
title Tiago Bot Forex - Simulator 24/7
cd /d "%~dp0"

if not exist logs mkdir logs

where node >nul 2>nul || (
  echo [ERRO] Node.js nao encontrado.
  pause
  exit /b 1
)

echo ==========================================
echo   TIAGO BOT - SIMULADOR 24/7 ATE 2027
echo ==========================================
echo.
echo Instalando dependencias e verificando projeto...
call npm install
if errorlevel 1 goto :fail
call npm run verify
if errorlevel 1 goto :fail

where ollama >nul 2>nul
if not errorlevel 1 (
  curl -s http://127.0.0.1:11434/api/tags >nul 2>nul
  if errorlevel 1 start "" /min ollama serve
)

echo.
echo O simulador salva:
echo   logs\simulator\YYYY-MM-DD.jsonl
echo   logs\simulator\trades.jsonl
echo   data\simulator-state.json
echo   data\simulator-risk.json
echo.
echo Se o servidor cair, este runner tenta novamente em 10 segundos.
echo Para parar, feche esta janela ou pressione Ctrl+C.
echo.

:loop
echo [%date% %time%] iniciando servidor >> logs\simulator-runner.log
call npm run dev:server >> logs\simulator-runner.log 2>&1
echo [%date% %time%] servidor encerrou; reiniciando em 10s >> logs\simulator-runner.log
timeout /t 10 /nobreak >nul
goto loop

:fail
echo.
echo [ERRO] Build/test falhou. Veja a mensagem acima.
pause
exit /b 1
