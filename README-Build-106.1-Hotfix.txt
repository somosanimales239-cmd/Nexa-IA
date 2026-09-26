Nexa AI v1.7.0 Build 106.1 — Visual Evaluator Hotfix

OBJETIVO
- Reaplicar y validar Nexa Visual Evaluator v1 sobre el código fuente de Nexa.
- Confirmar que la UI muestre la sección “Nexa Visual Evaluator v1”.
- Confirmar que cada imagen generada pueda ser evaluada por Qwen2.5-VL:3b.

IMPORTANTE
- Este update se ejecuta SOBRE EL CODIGO FUENTE de Nexa, no sobre el .exe empaquetado.
- Debes extraer este ZIP dentro de la carpeta raiz del proyecto donde existan:
  main.js
  preload.js
  package.json
  src\index.html
  src\app.js
  nexa.project.json

INSTALACION RAPIDA
1) Cierra Nexa AI.
2) Extrae este ZIP dentro de la carpeta raíz del proyecto Nexa.
3) Ejecuta: INSTALL-BUILD-106-HOTFIX.cmd
4) Espera el mensaje: INSTALADO Y VALIDADO.
5) Abre Nexa y ve a Ajustes.
6) Debes ver la sección: Nexa Visual Evaluator v1.
7) Debe indicar READY si qwen2.5vl:3b ya está instalado.

SI NO APARECE LA SECCION EN AJUSTES
- El parche no se aplicó al proyecto correcto.
- Repite la instalación directamente dentro de la carpeta fuente de Nexa.

PRUEBA RECOMENDADA
Prompt:
Crea exactamente un solo kanguro boxeador estilo cartoon, de encuadre cercano, con guantes rojos, pose dinámica, sin segundo personaje.

CONDUCTA ESPERADA
- Si el primer intento genera 2 sujetos o un animal equivocado,
  Nexa Visual debe revisarlo y regenerar.
- El mensaje final debe mencionar Nexa Visual y la puntuación.

MODELO VISUAL
- Qwen2.5-VL 3B debe estar instalado en Ollama.
- Comando manual:
  D:\LocalAI\Ollama\ollama.exe list

VALIDACION MANUAL
- En la raíz del proyecto, puedes ejecutar:
  node scripts/validate-visual-evaluator.js

ROLLBACK
- Usa ROLLBACK-BUILD-106.cmd si necesitas volver atrás.
