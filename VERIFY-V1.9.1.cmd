@echo off
setlocal
cd /d "%~dp0"
echo === Nexa AI v1.9.1 Web Intelligence verification ===
node --check main-v191.js || exit /b 1
node --check lib\web-intelligence-v191.js || exit /b 1
node --check src\web-intelligence-v191.js || exit /b 1
node scripts\validate-v191.js || exit /b 1
node scripts\validate-v190.js || exit /b 1
node scripts\validate-v189.js || exit /b 1
node scripts\validate-v188.js || exit /b 1
node scripts\test-v191-web-intelligence.js || exit /b 1
node scripts\test-v190-routing.js || exit /b 1
call npm run validate || exit /b 1
echo.
echo PASS - Nexa AI v1.9.1 full project validation complete.
pause
