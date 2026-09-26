# Nexa AI v1.8.3 — No Timeout + Status System

## Objetivo
Eliminar cualquier bloqueo automático por tiempo en el pipeline visual y reemplazarlo por un sistema de estado visible.

## Cambio principal
- Se eliminan los abortos automáticos por límite de tiempo.
- El pipeline visual solo termina por:
  - aprobación de imagen,
  - máximo de intentos alcanzado,
  - error real del proceso,
  - cancelación manual del usuario.
- Se agrega un sistema de estados y heartbeat.

## Estados sugeridos
- QUEUED
- RENDER_START
- RENDER_WORKING
- RENDER_DONE
- REVIEW_START
- REVIEW_WORKING
- REVIEW_DONE
- REPAIRING
- RETRYING
- APPROVED
- FAILED
- CANCELED

## Comportamiento esperado
Nexa no debe volver a mostrar:
"La generación de imagen superó X minutos y fue detenida..."

En su lugar debe mostrar estados como:
- Renderizando intento 1/3…
- Revisando imagen con Qwen 1/3…
- Reparando prompt…
- Reintentando 2/3…
- Nexa Visual aprobó la imagen · 93/100
