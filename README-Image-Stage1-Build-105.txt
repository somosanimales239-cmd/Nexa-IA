Nexa AI v1.7.0 Build 105 - Stable Image Recovery

Base exacta:
- Git commit 6f94e969174c7dfe5cd1d2bdca02c9c73359d5f2
- Build 104 del repositorio actual

Problema encontrado:
- Build 104 descargaba gpt-oss de Ollama antes de cada render.
- La siguiente respuesta de texto tenia que volver a cargar el modelo completo y podia parecer congelada.
- El planificador de imagen podia esperar hasta 60 segundos antes de llegar a ComfyUI.
- La limpieza del loader dependia de varias rutas separadas y podia quedar desincronizada.

Correccion Build 105:
- NO descarga Ollama antes de generar imagen.
- Si gpt-oss ya esta cargado, Nexa puede usarlo hasta 15 segundos para mejorar el prompt.
- Si gpt-oss no esta cargado o tarda, Nexa usa inmediatamente su planificador interno de respaldo.
- Parametros tecnicos estables de SDXL: Euler + Normal, 28-30 pasos, CFG 5.5-6.0.
- Nexa consulta ComfyUI y normaliza a valores locales validos cuando sea necesario.
- Al terminar una imagen, Nexa pide a ComfyUI liberar modelos/cache para devolver VRAM al chat de texto.
- El loader se controla con una sola finalizacion garantizada.
- Hay watchdog de 6 minutos: si una imagen se atasca, Nexa la detiene y recupera la interfaz.
- Detener borra la tarea pendiente, interrumpe el prompt activo y libera recursos de ComfyUI.
- Se conserva vista limpia, abrir grande y descargar.
- Se conservan los fixes de respuestas largas y fuentes ocultas.

Archivos completos incluidos:
- main.js
- preload.js
- src/app.js
- src/app.css
- src/index.html
