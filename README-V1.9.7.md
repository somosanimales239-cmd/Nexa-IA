# Nexa AI v1.9.7 — COMPLETE FIX2

Este ZIP reemplaza los ZIP v1.9.7 anteriores.

Incluye en un solo paquete:
- Comfy Model Inspector
- Smart Checkpoint Router
- Style Authority Engine
- High-Resolution 4K Pipeline
- Build Gate FIX1
- Legacy Layer Validator FIX2

## Error corregido del run 36503597696
El Validation Gate general ya pasaba, pero `npm run build:win` vuelve a ejecutar `npm run validate`.
Durante ese segundo pase, `scripts/validate-v195.js` exigía incorrectamente que el package activo siguiera siendo exactamente v1.9.5 / main-v195.js, aunque la aplicación activa es v1.9.7 / main-v197.js.

FIX2 convierte `validate-v195.js` en un validador de capa compatible con versiones posteriores:
- verifica que la entrada activa encadene transitivamente a `main-v195.js`;
- conserva la comprobación de la capa v1.9.5 y su cadena a v1.9.4;
- conserva sus dependencias, scripts y build files;
- compara `nexa.project.json` contra la versión activa real del package, no contra 1.9.5 fijo.

No se modifica la lógica de imagen, ComfyUI, Qwen, Web Intelligence ni la UI con este FIX2.
