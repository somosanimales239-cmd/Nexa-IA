# Nexa AI v1.7.0

## Build 99 chat completion update
- Normal chat now sends GPT-OSS requests with `think: false` so the generation budget is used for the visible answer instead of hidden reasoning.
- Chat uses an effective context floor of 12,288 tokens and requests up to 4,096 visible response tokens.
- Only the latest eight conversation messages are resent because Knowledge and Memory are already injected separately.
- Source metadata remains stored internally, but the visual `Fuentes usadas` block is no longer rendered in the conversation.
- No changes were made to Knowledge DB, Memory, Browser Bridge, Auto Knowledge Factory, research storage, or the selected local model.

- Nuevo modo de respuesta con trazabilidad: Knowledge local y documentos recuperados se convierten en la base principal de las respuestas relacionadas.
- Las fuentes recuperadas reciben identificadores `[K1]`, `[K2]`, `[D1]`, etc.; Nexa debe citar los hechos técnicos cerca de la afirmación correspondiente.
- Para preguntas de un vehículo/año concreto, Nexa no debe rellenar especificaciones críticas desde conocimiento general si no aparecen en evidencia local compatible.
- Si mezcla Knowledge local con conocimiento general del modelo, lo declara explícitamente al final de la respuesta.
- La recuperación de Knowledge mejora el ranking por fabricante, modelo, año, categoría, estado de verificación y confianza.
- Los enlaces `http://` y `https://` dentro de las respuestas y las fichas de fuente son clicables y se abren en el navegador predeterminado mediante IPC seguro.
- Conversaciones: títulos multilínea contenidos dentro de su tarjeta, scrollbar propia cuando crece la lista, y hasta 10 conversaciones favoritas ancladas.
- Los chats existentes se conservan. El nuevo estado `pinned/pinnedAt` es aditivo y no borra historial, Memory ni Knowledge.
- Browser Bridge API v1 y `nexa-knowledge.db` permanecen compatibles con la extensión actual.

## 1.6.1
- Corrige Auto Knowledge Factory cuando todos los años terminaban en REVIEW durante DISCOVERY.
- Discovery usa tres consultas web complementarias y hasta 12 fuentes únicas.
- El parser acepta protocolo Nexa, JSON y campos de texto simples del modelo.
- Si el modelo no estructura la salida pero las fuentes coinciden exactamente con make/model/year, crea una configuración conservadora PARTIAL desde evidencia en lugar de descartar el año.
- Los años antiguos en NEEDS_REVIEW sin configuraciones vuelven automáticamente a QUEUED al reanudar la fábrica.
- Ver años muestra ahora `last_error`/motivo de discovery.
- DISCOVERY ya no envía un año a REVIEW solo porque el modelo falló tres veces al formatear su respuesta.
