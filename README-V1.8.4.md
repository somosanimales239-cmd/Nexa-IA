# Nexa AI v1.8.4 — Stable Visual Review

Este update conserva el flujo visual que ya estaba generando y revisando correctamente y corrige únicamente el fallo de formato de Qwen.

Cambios:
- Qwen puede devolver JSON directo, JSON dentro de markdown o texto alrededor.
- Si el JSON viene mal formado, Nexa hace una segunda pasada de normalización.
- Si aun así no hay JSON, Nexa extrae una evaluación mínima desde el texto y CONTINÚA; no aborta toda la generación.
- Se elimina el timeout global de 6 minutos desde el bridge mediante un override del renderer.
- Los retries de ComfyUI no tienen límite global de tiempo; solo se detienen por error real o cancelación manual.
- Se escribe D:\LocalAI\NexaAI\Data\visual-status-v184.json con el estado actual.

La cadena `Qwen2.5-VL no devolvió JSON utilizable` ya no existe en main-v184.js.
