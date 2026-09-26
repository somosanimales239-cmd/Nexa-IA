@echo off
setlocal
cd /d "%~dp0"
echo Checking Nexa AI v1.8.0 Visual Review Pipeline...
node scripts\validate-v180-visual-pipeline.js
if errorlevel 1 (
  echo Validation failed.
  pause
  exit /b 1
)
echo Validation passed.
pause
