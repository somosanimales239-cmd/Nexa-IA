# Nexa AI v1.9.7 — Comfy Model Inspector + Smart Checkpoint Router + High-Resolution 4K Pipeline

## Objetivo
Entregar en un solo update todo lo del v1.9.6 **más** la sustitución general de `4K = Lanczos` por un pipeline de alta resolución más inteligente.

## Qué corrige
- Evita que `4K` signifique solamente “archivo agrandado”.
- Mantiene el **Comfy Model Inspector** y el **Smart Checkpoint Router**.
- Añade un pipeline high-res con dos etapas:
  1. **Latent refine** a resolución intermedia segura para el checkpoint.
  2. **Exact-scale** al tamaño final solicitado.
- Registra en el resultado qué checkpoint se usó y qué etapas high-res se ejecutaron.
- Si el refine falla por disponibilidad de nodos o compatibilidad, Nexa cae en fallback a escala exacta sin romper la generación.

## Pipeline nuevo
Para solicitudes 4K / 2K / 1080 / dimensiones exactas:
- Nexa calcula el objetivo exacto (`3840×2160`, `2160×3840`, etc.).
- Ejecuta una etapa `latent-refine` con `CheckpointLoaderSimple + VAEEncode + LatentUpscale + KSampler + VAEDecode`.
- Después ejecuta `exact-scale` para entregar el tamaño final exacto.
- Se reporta en metadatos si se usó el pipeline completo o si hubo fallback.

## Archivos editados / agregados
- `main-v197.js`
- `lib/image-intelligence-v197.js`
- `lib/highres-pipeline-v197.js`
- `src/image-intelligence-v197.js`
- `scripts/validate-v197.js`
- `scripts/test-v197-image-intelligence.js`
- `package.json`
- `nexa.project.json`
- `README-V1.9.7.md`
- `UPDATE-MANIFEST-V1.9.7.json`

## Instalación
Sube y reemplaza solo estos archivos sobre tu instalación actual.
