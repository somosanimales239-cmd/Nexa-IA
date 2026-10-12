@echo off
setlocal
set "PY=D:\LocalAI\Aider\.venv\Scripts\python.exe"
set "SCRIPT=%~dp0WINDOWS_SOURCE_OVERLAY\lib\nexa-aider-analyzer.py"
echo =================================================
echo NEXA AIDER - PRUEBA REAL DE SOLO LECTURA
 echo No instala ni actualiza el programa Nexa.
echo =================================================
if not exist "%PY%" (echo ERROR: no se encontro Python de Aider en D:.& exit /b 2)
if not exist "%SCRIPT%" (echo ERROR: falta el analizador del paquete.& exit /b 3)
"%PY%" "%SCRIPT%" --probe
if errorlevel 1 (echo ERROR: fallaron los parsers Aider. NO compilar el update.& exit /b 4)
echo AIDER PROBE OK - Proximo paso: instalar el overlay en App Builder y compilar UNA VEZ.
exit /b 0
