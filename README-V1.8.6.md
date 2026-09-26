# Nexa AI v1.8.6 — Soft Review + Reference Consistency

## Objetivo
Esta versión aplica dos cambios sin tocar lo que ya viene funcionando en la generación base:

1. **Decision Engine menos agresivo**
   - `UNCERTAIN` ya no se trata como error crítico.
   - Solo los fallos realmente graves fuerzan `retry`.
   - Se reducen los falsos rechazos de imágenes buenas.

2. **Área de imágenes de referencia**
   - Permite cargar una o varias imágenes para:
     - parecido / likeness
     - consistencia de personaje
     - consistencia de producto/objeto
     - consistencia de estilo
     - consistencia de composición
   - Añade parámetros de fuerza para controlar cuánto influye cada referencia.

## Qué NO rompe
- No cambia ComfyUI base.
- No elimina Qwen.
- No quita retries.
- No quita el sistema de estado.
- No toca lo que ya está funcionando en la generación principal.

## Comportamiento nuevo de review
### Hard failures
- wrong subject
- wrong subject count
- duplicate subject
- wrong species
- missing explicitly required object
- severe anatomy problem

### Soft checks
- pose
- framing
- style similarity leve
- background preference
- expression preference

`UNCERTAIN` pasa a ser una penalización suave, no rechazo automático.

## Área de referencias
Se agrega una sección tipo:
- Activar referencias visuales
- Cargar 1–6 imágenes
- Modo de referencia:
  - likeness
  - style
  - composition
  - consistency
  - product
- Intensidad general 0–100
- Peso de identidad 0–100
- Peso de estilo 0–100
- Mantener consistencia en reintentos
- Usar mejor imagen aprobada como ancla

## Resultado esperado
- Menos reintentos innecesarios
- Más consistencia de personaje/objeto
- Mejor parecido cuando subes imágenes de referencia
