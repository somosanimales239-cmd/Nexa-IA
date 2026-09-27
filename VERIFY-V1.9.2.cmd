@echo off
setlocal
cd /d "%~dp0"
node --check main-v192.js || exit /b 1
node --check lib\web-intelligence-refinements-v192.js || exit /b 1
node --check src\conversation-tools-v192.js || exit /b 1
node scripts\test-v192-refinements.js || exit /b 1
node scripts\validate-v192.js || exit /b 1
echo.
echo Nexa AI v1.9.2 local update checks: PASS
pause
