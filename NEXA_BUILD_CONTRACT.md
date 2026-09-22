# Nexa AI 1.7.0 Build Contract

Actualizar Nexa AI desde 1.6.1 a **1.7.0** como una actualización coherente y aditiva. No borrar ni reiniciar chats, Memory, Knowledge Libraries, Browser Bridge pairing, `nexa-knowledge.db`, objetivos, evidencias ni colas existentes.

## Grounded answers
- Priorizar Knowledge/documentos recuperados para preguntas relacionadas.
- Asignar IDs K/D a fuentes recuperadas y pedir citas cercanas a las afirmaciones.
- No completar especificaciones técnicas concretas de otro año/motor/mercado desde conocimiento general del modelo.
- PARTIAL debe conservar incertidumbre.
- Declarar si la respuesta usó Knowledge local, mezcla con contexto general, o solo conocimiento general por falta de evidencia.
- URLs solo pueden repetirse si aparecen realmente en las fuentes recuperadas.

## Clickable web links
- Los enlaces HTTP/HTTPS de mensajes y source chips deben abrirse en el navegador predeterminado.
- No habilitar `nodeIntegration`; mantener `contextIsolation` y sandbox.
- Validar el protocolo en main process antes de llamar `shell.openExternal`.

## Conversations
- Títulos largos deben permanecer dentro de la tarjeta.
- Scrollbar vertical propia para listas largas.
- Máximo 10 conversaciones ancladas.
- `pinned` y `pinnedAt` se guardan de forma compatible en el JSON existente.

## Compatibility
Mantener Browser Bridge API v1 en `127.0.0.1:32145/api/v1`. No se requiere cambio de extensión para estas funciones.

## Validation
`npm run validate` debe terminar con cero fallos antes de empaquetar.
