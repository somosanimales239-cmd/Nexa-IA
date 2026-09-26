@echo off
setlocal
set "OLLAMA_MODELS=D:\LocalAI\Models"
set "NEXA_OLLAMA=D:\LocalAI\Ollama\ollama.exe"

echo ------------------------------------------------------------
echo Nexa Visual Evaluator v1 - Qwen2.5-VL 3B
echo ------------------------------------------------------------
if exist "%NEXA_OLLAMA%" (
  echo Usando: %NEXA_OLLAMA%
  "%NEXA_OLLAMA%" pull qwen2.5vl:3b
) else (
  where ollama >nul 2>nul
  if errorlevel 1 (
    echo ERROR: No se encontro Ollama.
    echo Ruta esperada: %NEXA_OLLAMA%
    echo Tambien puedes instalar Ollama desde https://ollama.com/download
    pause
    exit /b 1
  )
  ollama pull qwen2.5vl:3b
)
if errorlevel 1 (
  echo.
  echo ERROR: No se pudo descargar qwen2.5vl:3b.
  pause
  exit /b 1
)
echo.
echo Qwen2.5-VL 3B instalado correctamente.
echo Nexa Build 106 lo detectara automaticamente.
pause
