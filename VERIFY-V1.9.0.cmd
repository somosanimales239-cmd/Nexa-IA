@echo off
setlocal
cd /d "%~dp0"
node scripts\validate-v190.js
pause
