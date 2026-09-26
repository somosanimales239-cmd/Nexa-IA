@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js no esta disponible en PATH.
  echo Ejecuta este update desde el entorno fuente de Nexa AI que usa Node 24 o superior.
  pause
  exit /b 1
)
node Install-Nexa-Build-106.js
if errorlevel 1 (
  echo.
  echo Build 106 NO se instalo. Si el parche habia comenzado, el instalador intento restaurar el backup.
  pause
  exit /b 1
)
echo.
echo Build 106 instalado correctamente.
pause
