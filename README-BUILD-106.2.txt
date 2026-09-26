Nexa AI v1.7.0 Build 106.2
Nexa Visual Evaluator Runtime Fix

PROPOSITO DEL UPDATE

La prueba manual confirmó que qwen2.5vl:3b está instalado correctamente, funciona con Ollama y puede analizar las imágenes generadas por Nexa.

El problema detectado era que Nexa continuaba ejecutando un runtime anterior. La aplicación mostraba solamente v1.7.0, no mostraba Build 106, no mostraba una puntuación de Nexa Visual y entregaba las imágenes sin pasar por el evaluador visual.

CAMBIOS PRINCIPALES

1. Integrar Nexa Visual Evaluator v1 con qwen2.5vl:3b.

2. Después de cada generación de ComfyUI, Nexa debe enviar la imagen generada al evaluador visual.

3. Qwen2.5-VL debe revisar la imagen y devolver una evaluación estructurada.

4. Nexa calcula la puntuación final a partir de esa evaluación.

5. Si existe un error crítico, Nexa no debe aceptar inmediatamente la imagen.

6. Nexa puede reparar el prompt y realizar un nuevo intento.

7. Se permiten hasta 3 intentos automáticos.

8. Nexa debe conservar y entregar el mejor resultado obtenido.

FLUJO ESPERADO

Usuario solicita una imagen

Nexa interpreta la solicitud

Nexa crea el prompt positivo y negativo

Nexa selecciona estilo y parámetros

ComfyUI genera la imagen

Nexa guarda temporalmente la imagen

Qwen2.5-VL 3B analiza la imagen

Nexa Quality Engine procesa la evaluación

Si la imagen es correcta, Nexa la entrega

Si la imagen falla, Nexa Repair Engine modifica el prompt

ComfyUI genera un nuevo intento

Nexa vuelve a evaluar

El proceso puede repetirse hasta un máximo de 3 intentos

Finalmente Nexa entrega el mejor resultado

ERRORES VISUALES CONTROLADOS

E001 WRONG_SUBJECT

E002 WRONG_SUBJECT_COUNT

E003 DUPLICATE_SUBJECT

E004 CROPPED_HEAD

E005 CROPPED_FEET

E006 CROPPED_BODY

E007 WRONG_STYLE

E008 WRONG_SPECIES

E009 ANATOMY_PROBLEM

E010 MISSING_REQUIRED_OBJECT

E011 EXTRA_OBJECT

E012 BACKGROUND_TOO_COMPLEX

E013 TEXT_ARTIFACT

E014 LOW_IMAGE_QUALITY

E015 WRONG_COLOR

E016 WRONG_POSE

MEJORAS DE CALIDAD DEL BUILD 106.2

El modo illustration ya no debe utilizar frases que favorezcan automáticamente una hoja de personajes o múltiples vistas.

Cuando Nexa detecte múltiples personajes o duplicados debe reforzar:

exactly one subject
single isolated character
one character only
no additional subjects

Y debe evitar:

character sheet
turnaround sheet
reference sheet
lineup
multiple views
multiple poses
duplicate character
second character

IDENTIDAD DE KANGURO

Cuando la solicitud requiera un kangaroo o canguro y Qwen detecte una especie incorrecta, Nexa Repair Engine debe reforzar:

unmistakable kangaroo
long upright kangaroo ears
elongated kangaroo muzzle
large muscular balancing tail
powerful kangaroo hind legs and feet
shorter forearms

También debe evitar:

bird beak
eagle head
pig face
boar face
bear muzzle
wrong animal
short tail
missing tail

QWEN VISUAL EVALUATOR

Modelo:

qwen2.5vl:3b

Ubicación de Ollama configurada en este sistema:

D:\LocalAI\Ollama\ollama.exe

El modelo puede comprobarse con:

D:\LocalAI\Ollama\ollama.exe list

El modelo qwen2.5vl:3b debe aparecer en la lista de modelos instalados.

CONFIGURACION RECOMENDADA

Nexa Visual Evaluator v1 activado

Modelo visual qwen2.5vl:3b

Quality Threshold 86

Maximum Attempts 3

Safe CPU activado inicialmente

Safe CPU evita que el evaluador visual compita innecesariamente con ComfyUI por la VRAM de la GPU.

COMPROBACION DEL BUILD

Después de instalar correctamente este update, Nexa debe mostrar:

v1.7.0 Build 106.2

En Ajustes debe existir una sección llamada:

Nexa Visual Evaluator v1

El estado esperado cuando Ollama y Qwen están disponibles es:

READY

Durante una generación deben aparecer etapas similares a:

Renderizando intento 1 de 3

Nexa Visual está revisando intento 1 de 3

Corrigiendo errores detectados

Renderizando intento 2 de 3

Nexa Visual está revisando nuevamente

Imagen aprobada

La imagen terminada debe poder mostrar:

Nexa Visual NN/100

y el número de intentos realizados.

PRUEBA RECOMENDADA

Crea exactamente un solo kanguro boxeador estilo cartoon, de encuadre cercano, con guantes rojos, pose dinámica y sin segundo personaje.

Si el primer resultado contiene varios personajes o una especie incorrecta, Nexa no debe entregarlo inmediatamente.

Debe evaluarlo, reparar el prompt, regenerar y volver a evaluar antes de seleccionar el resultado final.

NOTA SOBRE WINDOWS PORTABLE

Si Nexa se está ejecutando desde un Portable EXE generado por electron-builder, el programa puede autoextraer sus recursos durante la ejecución.

En ese caso, modificar una carpeta fuente separada no cambia automáticamente el EXE Portable que ya existe.

Para una actualización persistente debe compilarse un nuevo Windows build desde el proyecto actualizado y ejecutarse ese nuevo archivo.

FIN DEL DOCUMENTO