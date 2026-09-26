@echo off
setlocal
cd /d "%~dp0"
node scripts\validate-v183.js
pause
