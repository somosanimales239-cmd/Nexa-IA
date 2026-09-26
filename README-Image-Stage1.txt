Nexa AI — Etapa 1 Imagenes (Texto a Imagen)

Archivos incluidos:
- main.js
- preload.js
- src/index.html
- src/app.css
- src/app.js

Que agrega este update:
1) Deteccion basica de solicitudes de imagen dentro del chat.
2) generate_image(user_request) interno:
   - interpreta la solicitud
   - crea positive prompt
   - crea negative prompt
   - decide estilo y tamano
   - envia el trabajo a ComfyUI
   - devuelve la imagen al chat
3) Vista limpia en el chat, sin marco pesado.
4) Click en la imagen para verla grande.
5) Boton para descargar la imagen.
6) Loader para texto y loader con logo animado para imagen.
7) Ajustes nuevos:
   - ComfyUI API
   - Checkpoint ComfyUI

Notas:
- ComfyUI debe estar encendido.
- URL por defecto: http://127.0.0.1:8188
- Si Nexa no detecta un checkpoint automaticamente, escribe el nombre exacto en Ajustes > Checkpoint ComfyUI.
- El modelo de Ollama se usa para planear mejor el prompt de la imagen cuando esta disponible; si no, Nexa usa una logica de respaldo.
