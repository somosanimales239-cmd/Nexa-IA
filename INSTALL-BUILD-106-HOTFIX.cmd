@echo off
setlocal
cd /d "%~dp0"
echo Installing Nexa AI v1.7.0 Build 106.1 Visual Evaluator Hotfix...
node Install-Nexa-Build-106.js
if errorlevel 1 (
  echo.
  echo Installation failed.
  pause
  exit /b 1
)
echo.
echo Hotfix installed and validated.
pause
