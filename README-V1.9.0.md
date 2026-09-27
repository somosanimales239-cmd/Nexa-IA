# Nexa AI v1.9.0 — Chat Attachments + Vision Intake

## Objetivo
Agregar a Nexa un sistema estilo ChatGPT para:
- arrastrar y soltar imágenes/documentos al chat
- seleccionar archivos desde un botón
- copiar y pegar imágenes/texto en el chat
- usar imágenes del chat como **Reference Images · Parecido y Consistencia**
- mandar imágenes del chat a Qwen para visión/preguntas normales

## Idea principal
El usuario ya no necesita comandos especiales.
El flujo debe ser natural:
1. Usuario escribe normal.
2. Usuario arrastra/pega/carga imagen o documento.
3. Nexa detecta el tipo de archivo.
4. Si es imagen:
   - puede usarse para visión general
   - puede usarse para parecido/consistencia
5. Si es documento:
   - Nexa lo adjunta al mensaje
   - puede extraer texto para contexto
6. Si el usuario dice “hazlo parecido”, “igual”, “same dog”, “usa esta imagen”, etc. la imagen del chat pasa al motor de referencia.

## Qué incluye este paquete
- UI de adjuntos en chat
- manejador drag & drop
- manejador paste
- ingestión de archivos
- router visión/referencias
- persistencia simple de adjuntos del mensaje
- validación del paquete
