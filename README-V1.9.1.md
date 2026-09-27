# Nexa AI v1.9.1 — Premium Web Intelligence

## Baseline
Este update es incremental y está preparado para el repositorio Nexa AI v1.9.0 actual.
No reemplaza Vision, Qwen, Reference Consistency, Knowledge ni Browser Bridge.

## Filosofía
El usuario pregunta normalmente. No necesita `/web`, `/search`, JSON ni comandos.

Pregunta normal
→ Premium Research Compiler (gpt-oss:20b)
→ estima confianza local y decide si necesita Internet
→ genera 2–5 consultas complementarias
→ Browser Bridge + búsqueda directa
→ prioriza fuentes primarias/oficiales
→ lee evidencia
→ Evidence Verifier
→ detecta scope incorrecto y contradicciones
→ entrega evidencia al chat
→ Nexa responde con enlaces reales

## Cuándo busca
- Petición explícita: “búscalo”, “investiga”, “verifica”.
- Información actual: versiones, precios, noticias, disponibilidad, reglas vigentes.
- Datos exactos/técnicos: torque, TSB, DTC, pinouts, capacidades, firmware, impuestos, etc.
- Preguntas donde el Research Compiler estime baja confianza local.

No debe buscar para saludos, cálculos simples, reescritura/traducción, tareas creativas ni explicaciones básicas que no necesiten evidencia actual.

## Reutiliza lo existente
- Browser Bridge / Chrome cuando está online.
- DuckDuckGo HTML / Lite.
- Bing RSS / HTML.
- `lib/web-research.js`.
- Knowledge research existente.
- `gpt-oss:20b` como Research Compiler y Evidence Verifier.

## Controles existentes
- **Permitir investigación por Internet** = interruptor maestro.
- **Investigar automáticamente** = permite búsqueda por baja confianza/necesidad detectada.
- Con auto-research apagado, una petición explícita de web todavía puede investigar si Internet Research está habilitado.

## Compatibilidad
La cadena queda:
`main-v191.js → main-v190.js → main-v189.js → main-v188.js → main.js`

Los mensajes con adjuntos siguen entrando primero al router v1.9.0 para conservar Qwen Vision, documentos y Reference Consistency.
