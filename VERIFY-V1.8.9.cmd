@echo off
setlocal
cd /d "%~dp0"
node --check main-v189.js
if errorlevel 1 exit /b 1
node --check lib\premium-prompt-compiler-v189.js
if errorlevel 1 exit /b 1
node scripts\validate-v189.js
pause
