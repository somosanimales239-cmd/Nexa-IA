@echo off
setlocal
cd /d "%~dp0"
for %%F in ("README-BUILD-106.2.txt" "README-BUILD-106.2a.txt" "FILES-BUILD-106.2.txt") do (
  if exist "%%~F" del /f /q "%%~F" >nul 2>nul
)
echo Nexa AI Build 106.2b Visual Evaluator Runtime Fix
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0PATCH-ACTIVE-NEXA-APP.ps1"
set ERR=%ERRORLEVEL%
echo.
if not "%ERR%"=="0" (
  echo Update failed with code %ERR%.
  pause
  exit /b %ERR%
)
echo Update completed.
pause
