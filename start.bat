@echo off
title GitVibe
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install it from https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install
)

echo Starting GitVibe at http://localhost:3000
echo Keep this window open so the autopilot keeps running.
node --no-warnings server/index.js
pause
