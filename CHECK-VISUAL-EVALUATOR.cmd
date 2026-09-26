@echo off
setlocal
cd /d "%~dp0"
echo Checking Nexa Visual Evaluator wiring...
node scripts/validate-visual-evaluator.js
if errorlevel 1 (
  echo.
  echo Validation failed.
  pause
  exit /b 1
)
echo.
echo Validation passed.
pause
