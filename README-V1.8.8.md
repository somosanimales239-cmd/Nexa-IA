# Nexa AI v1.8.8 — Prompt Compiler Premium + Reference Consistency

Este update parte del pipeline estable v1.8.5 y conserva la revisión repeat-safe de Qwen.

## Cambios
- Antes del primer render, el pedido simple se convierte en un **Premium Positive Prompt** y **Premium Negative Prompt**.
- Soft Review: `uncertain` no es fallo crítico.
- Se amplía detección de especies comunes: dog/puppy/perro/perrito, cat/gato, rabbit/conejo, fox/zorro, bear/oso, etc.
- Referencias: hasta 4 imágenes.
- Qwen extrae Visual DNA: colores, marcas, proporciones, estilo y rasgos que deben preservarse.
- Imagen #1 puede ser **ancla img2img real en ComfyUI durante retries** usando nodos core LoadImage + ImageScale + VAEEncode.
- Si el ancla directa falla, Nexa continúa con Visual DNA sin bloquear la generación.
- Cuando modo Likeness/Consistency/Product está activo, una divergencia clara de identidad produce E019 REFERENCE_MISMATCH.

## Parámetros recomendados
- Mode: Consistency
- Strength: 80
- Identity Weight: 92
- Style Weight: 65
- Composition Weight: 40
- Use references during retries: ON
- Use image #1 as direct retry anchor: ON

## Flujo
Usuario → Prompt Compiler Premium → referencia/Visual DNA → ComfyUI → Qwen Review → Repair → retry con ancla opcional → mejor resultado.

## Instalación
Actualiza/agrega los archivos del ZIP respetando rutas. `package.json` debe quedar con:
- version: 1.8.8
- main: main-v188.js

No borres `main.js`, `preload.js`, `src/app.js` ni `src/index.html` de tu proyecto actual.
