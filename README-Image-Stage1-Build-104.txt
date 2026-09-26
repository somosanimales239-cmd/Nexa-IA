Nexa AI v1.7.0 Build 104 — Stable Image Runtime

Objetivo de este update:
- eliminar el estado aparente de congelamiento durante imagenes
- hacer visible el progreso real de la generacion
- liberar VRAM antes de arrancar ComfyUI
- hacer que Detener cancele tanto el planificador de Ollama como ComfyUI
- mantener calidad alta sin usar parametros innecesariamente pesados para GTX 1070 Ti 8 GB

Cambios principales:
1. Loader/progreso
- El loader aparece ANTES de guardar el chat o iniciar tareas largas.
- Nexa muestra fases: preparando prompt, liberando GPU, conectando ComfyUI, renderizando y guardando.
- El logo animado permanece visible mientras la solicitud esta activa.
- Al terminar o cancelar, se apaga.

2. GPU / estabilidad
- El planificador usa think:false y maximo 500 tokens.
- Despues de crear el prompt, Nexa libera el modelo Ollama de VRAM antes de ejecutar SDXL en ComfyUI.
- Esto evita que gpt-oss:20b y SDXL compitan por los mismos 8 GB de VRAM.

3. Detener
- Cancela la solicitud del planificador local si aun esta preparando el prompt.
- Si ComfyUI ya tiene el trabajo, intenta borrarlo de la cola y envia interrupt.
- La UI deja de mostrar generacion inmediatamente.

4. Parametros de calidad equilibrados
- Illustration/cartoon: 896x896 por defecto, 28 steps, CFG 6.0, DPM++ 2M + Karras si esta disponible.
- Photorealistic: 28 steps, CFG 5.5, DPM++ 2M SDE + Karras.
- Cinematic: 30 steps, CFG 6.0.
- Anime: 26 steps, CFG 6.0.
- 3D: 28 steps, CFG 6.0.
- Portrait/full body: 768x1024.
- Landscape/car/room: 1024x768.
- 16:9: 1024x576.
- 9:16: 576x1024.
- Un tamano explicito pedido por el usuario sigue siendo respetado dentro de los limites seguros existentes.

Base:
- Nexa AI v1.7.0 Build 103
- Git commit: 226a26672c0a23e34ac39ce025c51280a00b50a4

Archivos completos incluidos:
- main.js
- preload.js
- src/app.js
- src/app.css
- src/index.html
