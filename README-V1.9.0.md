# Nexa AI v1.9.0 — Chat Attachments + Qwen Vision

Update overlay para el proyecto Nexa AI v1.8.9 existente.

## Incluye
- botón + en el compositor real
- drag & drop
- Ctrl+V de imágenes
- Ctrl+V de texto normal sin interferencia
- imágenes PNG/JPG/JPEG/WEBP
- PDF/DOCX/TXT/MD/CSV/JSON
- Qwen2.5-VL:3b para preguntas visuales
- documentos como contexto de chat
- imágenes del chat como Reference Consistency
- lenguaje natural: “el mismo perrito pero en un parque…” se enruta como generación si hay imagen adjunta
- adjuntos persistentes en el historial mediante metadata `chat_attachment`
- el panel viejo Reference Images de Settings queda oculto

## Cadena runtime
main-v190.js → main-v189.js → main-v188.js → main.js

## Importante
Este ZIP es un UPDATE OVERLAY para subir sobre el proyecto v1.8.9 actual. No es un proyecto independiente nuevo.
