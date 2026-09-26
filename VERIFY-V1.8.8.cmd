@echo off
setlocal
cd /d "%~dp0"
node --check main-v188.js
if errorlevel 1 exit /b 1
node --check lib\visual-review-v188.js
if errorlevel 1 exit /b 1
node --check src\reference-panel-v188.js
if errorlevel 1 exit /b 1
node scripts\validate-v188.js
pause
