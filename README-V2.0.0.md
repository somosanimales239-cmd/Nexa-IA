# Nexa AI v2.0.0 — Web Control Center + Forge WebUI

## Objetivo
Nexa deja de depender de la ventana Electron como interfaz principal. La aplicación sigue corriendo localmente como backend, pero al iniciar abre una página web local:

`http://127.0.0.1:32146/`

Desde esa página se manejan Chat, Image Studio, Knowledge, Memory, System y Settings.

## Arquitectura

Browser Web UI
→ Nexa Web Control (localhost:32146)
→ mismos handlers internos de Nexa para chat/memoria/conocimiento
→ Ollama / Web Intelligence / Qwen según el flujo existente
→ Forge WebUI API para generación de imágenes

La página es local-only: el servidor escucha en `127.0.0.1` y las operaciones usan un token de sesión generado al arrancar.

## Forge
Forge debe ejecutarse con la API habilitada. En `webui-user.bat` puede usarse:

`set COMMANDLINE_ARGS=--api`

Por defecto Nexa Web Control busca Forge en:

`http://127.0.0.1:7860`

La URL puede cambiarse desde Settings en la página.

## Image Studio
La página obtiene directamente desde Forge:
- checkpoints/modelos
- samplers
- schedulers
- upscalers
- latent upscalers

La generación se hace mediante la API de Forge/A1111-compatible. Los filtros y parámetros se controlan desde la página, no desde la UI Electron.

Para 4K horizontal:
- base: 1024×576
- Hires Fix opcional
- upscale final exacto: 3840×2160 usando un upscaler disponible en Forge

Para 4K vertical:
- base: 576×1024
- upscale final exacto: 2160×3840

## Funciones web conectadas a Nexa
- conversaciones persistentes
- streaming del chat local
- Web Intelligence existente a través del mismo backend de chat
- adjuntos de imágenes/PDF/DOCX/TXT/MD/CSV/JSON
- memoria persistente
- búsqueda de Knowledge
- librerías y objetivos visibles
- Ollama start / warm / unload
- estado del sistema
- Forge status
- Image Studio Forge
- generación natural desde chat: si el texto pide una imagen, la página lo dirige a Forge

## Compatibilidad
La capa v2.0.0 carga `main-v198.js` sin reemplazar el backend existente. La ventana Electron se mantiene como fallback y se minimiza por defecto.

Para mantener la ventana Electron visible al iniciar, puede ejecutarse con:

`NEXA_KEEP_DESKTOP_UI=1`

## Archivos del update
- `main-v200.js`
- `lib/nexa-web-control-v200.js`
- `webapp/index.html`
- `webapp/app.css`
- `webapp/app.js`
- `scripts/validate-v200.js`
- `scripts/test-v200-web-control.js`
- `scripts/validate-v198.js` (compatibilidad de capas)
- `package.json`
- `nexa.project.json`
- `README-V2.0.0.md`
- `UPDATE-MANIFEST-V2.0.0.json`
