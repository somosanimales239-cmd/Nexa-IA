Nexa AI v1.7.0 Build 102 — Image Stage 1 ComfyUI Fix

Este update corrige la comunicacion de Nexa AI con ComfyUI para la generacion de imagenes.

Incluye:
- Normalizacion automatica de sampler_name y scheduler a valores validos de ComfyUI.
- Deteccion dinamica de opciones disponibles desde KSampler.
- Mejor control de detener para imagenes:
  - marca la tarea como cancelada
  - intenta sacarla de la cola
  - envia interrupt a ComfyUI
- Se mantienen los loaders:
  - texto: puntos animados
  - imagen: logo animado mientras genera
- El loader se oculta al terminar o al cancelar.
- Se mantiene la vista limpia de la imagen, vista grande y descarga.

Archivos incluidos:
- main.js
- preload.js
- src/app.js
- src/app.css
- src/index.html

Configuracion requerida en Nexa:
- ComfyUI API: http://127.0.0.1:8188
- Checkpoint ComfyUI: nombre exacto del checkpoint, por ejemplo:
  sd_xl_base_1.0.safetensors

Importante:
- ComfyUI debe estar abierto mientras Nexa genera la imagen.
