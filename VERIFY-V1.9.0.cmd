@echo off
setlocal
cd /d "%~dp0"
node --check main-v190.js || exit /b 1
node --check preload.js || exit /b 1
node --check src\chat-attachments-v190.js || exit /b 1
node --check lib\chat-routing-v190.js || exit /b 1
node scripts\test-v190-routing.js || exit /b 1
node scripts\validate-v190.js || exit /b 1
node scripts\validate-v189.js || exit /b 1
node scripts\validate-v188.js || exit /b 1
echo Nexa AI v1.9.0 update checks OK.
pause
