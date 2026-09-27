# Nexa AI v1.8.9 — Invisible Premium Prompt Compiler

Esta versión se monta sobre la v1.8.8 que ya funciona. No cambia la UI.

## Flujo
Usuario escribe normal -> Nexa compila internamente -> Positive Premium + Negative Premium + hard rules + soft aesthetic rules + size/style/composition -> v1.8.8 genera -> Qwen revisa -> repair/retry.

## Diferencia clave
Los detalles estéticos que Nexa añade (lighting, polish, depth of field) son SOFT. Qwen no debe rechazarlos como requisitos del usuario.
Las restricciones explícitas del usuario son HARD: por ejemplo "el mismo perrito", "exactamente 4 gatos", "en un parque", "mismo estilo".

## Ejemplo
Entrada: `el mismo perrito pero en un parque jugando con 4 gatos que tengan el mismo estilo de imagen que él`

El compilador crea internamente reglas como:
- preserve the same main subject identity from the uploaded reference
- exactly 4 cats, all four visible and countable
- clearly recognizable park environment
- playing interaction
- all subjects use the same visual rendering language as the reference

Y negativos como:
- different main character
- identity drift
- fewer than 4 cats
- more than 4 cats
- extra cats
- missing cats
- mixed rendering styles
- character sheet / multiple views / collage

## Instalación
Actualizar/agregar solamente:
- package.json
- nexa.project.json
- main-v189.js
- lib/premium-prompt-compiler-v189.js
- scripts/validate-v189.js

No borrar v1.8.8:
- main-v188.js
- lib/visual-review-v188.js
- src/reference-panel-v188.js
- main.js / preload.js / src/app.js / src/index.html
