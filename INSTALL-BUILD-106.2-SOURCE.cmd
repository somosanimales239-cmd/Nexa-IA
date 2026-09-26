@echo off
setlocal
cd /d "%~dp0"
node Install-Nexa-Build-106.2.js
if errorlevel 1 (
  echo.
  echo Build 106.2 source installation failed.
  pause
  exit /b 1
)
echo.
echo Build 106.2 source installed and validated.
pause
