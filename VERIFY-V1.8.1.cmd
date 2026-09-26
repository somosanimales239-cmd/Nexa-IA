@echo off
setlocal
cd /d "%~dp0"
node --check main-v181.js || exit /b 1
node --check lib\visual-review-v181.js || exit /b 1
node scripts\validate-v181.js || exit /b 1
echo Nexa AI v1.8.1 validation OK.
pause
