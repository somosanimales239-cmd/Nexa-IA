@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js no esta disponible en PATH.
  pause
  exit /b 1
)
node Rollback-Nexa-Build-106.js
pause
