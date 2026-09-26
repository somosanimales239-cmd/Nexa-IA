@echo off
setlocal
cd /d "%~dp0"
node --check main-v184.js
node --check lib\visual-review-v184.js
node scripts\validate-v184.js
pause
