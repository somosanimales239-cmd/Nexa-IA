@echo off
node --check main-v193.js || exit /b 1
node --check lib\visual-prompt-writer-v193.js || exit /b 1
node scripts\validate-v193.js || exit /b 1
node scripts\test-v193-prompt-writer.js || exit /b 1
node scripts\validate-v192.js || exit /b 1
node scripts\test-v192-refinements.js || exit /b 1
echo Nexa AI v1.9.3 verification complete.
