@echo off
setlocal
title Tiago Bot Forex - OANDA Practice 24/7
cd /d "%~dp0"

if not exist logs mkdir logs

where node >nul 2>nul || (
  echo [ERRO] Node.js nao encontrado.
  pause
  exit /b 1
)

echo ==========================================
echo   TIAGO BOT - OANDA PRACTICE 24/7
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
echo Resultados oficiais: OANDA Practice /api/oanda-audit
echo Shadow: logs\shadow-paper\trades.jsonl
echo Ollama: logs\ollama-paper\oanda-mirror.jsonl
echo.
echo Se o servidor cair, este runner tenta novamente em 10 segundos.
echo Para parar, feche esta janela ou pressione Ctrl+C.
echo.

echo Iniciando dashboard...
start "Tiago Dashboard" /min cmd /c "npm run dev:client >> logs\client-runner.log 2>&1"
timeout /t 3 /nobreak >nul

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if exist "%CHROME%" (
  start "" "%CHROME%" "http://127.0.0.1:5173"
) else (
  echo [AVISO] Google Chrome nao foi encontrado. Abrindo no navegador padrao...
  start "" "http://127.0.0.1:5173"
)

:loop
echo [%date% %time%] iniciando servidor >> logs\tiago-runner.log
call npm run dev:server >> logs\tiago-runner.log 2>&1
echo [%date% %time%] servidor encerrou; reiniciando em 10s >> logs\tiago-runner.log
timeout /t 10 /nobreak >nul
goto loop

:fail
echo.
echo [ERRO] Build/test falhou. Veja a mensagem acima.
pause
exit /b 1
