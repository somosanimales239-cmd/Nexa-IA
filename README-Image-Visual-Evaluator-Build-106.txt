Nexa AI v1.7.0 Build 106 — Nexa Visual Evaluator v1

BASE EXACTA
- Nexa AI v1.7.0 Build 105
- Git baseline auditado: commit 612fa64661edbceafb0b2d2347a4de568aff8a0c
- Este paquete NO reemplaza Knowledge, Browser Bridge, Auto Knowledge Factory ni el chat local.

OBJETIVO
Agregar un evaluador visual local que inspecciona cada imagen generada por ComfyUI antes de entregarla.
Modelo recomendado/default: qwen2.5vl:3b mediante Ollama.

FLUJO BUILD 106
Nexa Image Planner
  -> ComfyUI / SDXL
  -> Nexa Visual Evaluator v1 (Qwen2.5-VL 3B)
  -> JSON estructurado
  -> Nexa Quality Engine
  -> PASS o Repair Engine
  -> máximo 3 intentos
  -> conserva el mejor resultado

SEGURIDAD DE RECURSOS
- En modo Safe, Qwen usa CPU: num_gpu=0.
- Qwen se invoca con keep_alive=0s para no quedar residente.
- ComfyUI se libera al terminar todo el ciclo.
- Si Qwen no está instalado, está desactivado, falla o devuelve JSON inválido, Nexa conserva el comportamiento de Build 105 y entrega la imagen de ComfyUI.
- El evaluador nunca debe convertirse en un punto único de fallo.

EVALUACIÓN
Qwen reporta hechos; Nexa calcula el score.
Checks:
- subject_identity
- subject_count
- species_identity
- framing
- style
- requested_attributes
- anatomy
- background
- text_integrity
- technical_quality

Threshold default: 86/100.
Errores críticos: E001 WRONG_SUBJECT, E002 WRONG_SUBJECT_COUNT, E003 DUPLICATE_SUBJECT, E008 WRONG_SPECIES.

RETRY
- Intento 1: prompt original/planificado.
- Intento 2: reparación dirigida solo a los fallos detectados.
- Intento 3: reparación fuerte y cumplimiento estricto.
- Nexa conserva el intento con mejor evaluación; no entrega automáticamente el último.

AJUSTES NUEVOS
- Activar/desactivar Nexa Visual Evaluator v1.
- Modelo (default qwen2.5vl:3b).
- Quality Threshold (default 86).
- Maximum Attempts (default 3).
- Safe CPU mode (default ON).
- Estado Installed / Not installed / Offline.
- Botón para instalar qwen2.5vl:3b con Ollama.

INSTALACIÓN DEL UPDATE
1. Cierra Nexa AI.
2. Copia este paquete dentro de la carpeta raíz del proyecto Build 105.
3. Ejecuta INSTALL-BUILD-106.cmd.
4. El instalador crea backup de los archivos que modifica.
5. Inicia Nexa AI.
6. Ve a Ajustes > Nexa Visual Evaluator v1.
7. Pulsa “Instalar Qwen2.5-VL 3B” si aún no está instalado.

INSTALACIÓN MANUAL DE QWEN
Con la ruta actual de Nexa/Ollama:
D:\LocalAI\Ollama\ollama.exe pull qwen2.5vl:3b

Prueba manual:
D:\LocalAI\Ollama\ollama.exe run qwen2.5vl:3b

Modelo oficial:
https://ollama.com/library/qwen2.5vl:3b

Tamaño aproximado del modelo Ollama qwen2.5vl:3b: 3.2 GB.
Requiere Ollama 0.7.0 o superior.

ROLLBACK
Ejecuta ROLLBACK-BUILD-106.cmd para restaurar los archivos guardados por el instalador.
