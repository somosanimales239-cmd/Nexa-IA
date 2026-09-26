@echo off
setlocal
cd /d "%~dp0"
node --check main-v185.js
node --check lib\visual-review-v185.js
node scripts\validate-v185.js
pause
