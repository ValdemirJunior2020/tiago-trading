@echo off
setlocal
title ProfitMind Forex
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is required.& pause & exit /b 1)
if not exist node_modules call npm install
if not exist .env copy .env.example .env >nul
where ollama >nul 2>nul
if not errorlevel 1 (
  curl -s http://127.0.0.1:11434/api/tags >nul 2>nul
  if errorlevel 1 start "" /min ollama serve
)
start "" cmd /k "npm run dev"
timeout /t 4 /nobreak >nul
start http://127.0.0.1:5173
