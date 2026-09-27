# Nexa AI v1.9.3 — Refusal-safe Visual Prompt Writer

Este update parte de v1.9.2 y no reemplaza las funciones existentes de Web Intelligence, Conversaciones, Qwen Vision, Reference Consistency ni el generador de imágenes.

## Nuevo comportamiento
Cuando el usuario pide texto para un prompt visual (`prompt master`, `hazme un prompt para una imagen`, etc.), Nexa hace primero el intento normal con `gpt-oss:20b` pero con una instrucción interna de Visual Prompt Writer.

Si la respuesta final es una negativa genérica del tipo `I’m sorry, but I can’t help with that`, solo esa respuesta se sustituye por un compilador interno determinista.

El compilador reutiliza `premium-prompt-compiler-v189.js`, por lo que genera la misma filosofía de:
- Prompt positivo premium
- Prompt negativo premium
- Tamaño recomendado
- Estilo
- Composición

## Similitudes / referencias conocidas
Una referencia como `Naruto` no se usa como orden de copia exacta en el fallback. Se transforma internamente en rasgos visuales amplios (anime shonen de acción ninja, line art energético, cel shading, composición dinámica) y se añaden restricciones de originalidad para evitar copiar literalmente rostro, uniforme, logotipos, insignias o símbolos.

El sistema también detecta lenguaje general como `similar`, `parecido`, `inspirado en`, `estilo de`, `like`, etc., y añade la misma regla de diseño original.

## Seguridad
El fallback no es un bypass universal de negativas. Solo se usa en solicitudes benignas de escritura de prompts visuales. Las negativas potencialmente relacionadas con contenido sexual de menores o sexo no consensuado no se sustituyen.


## App Builder compatibility FIX1
The active Electron entry now exposes a side-effect-free renderer/preload graph declaration so Nexa App Builder can identify `src/index.html` directly from `main-v193.js` without changing the stable runtime chain.
