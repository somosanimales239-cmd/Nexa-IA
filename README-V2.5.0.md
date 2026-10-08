# Nexa AI v2.5.0 — Developer Runtime

Update grande para el software local **Nexa AI**. Se monta sobre la instalación actual v2.0.3 y conserva la cadena existente:

`main-v203.js → main-v198.js → capas anteriores`

No reemplaza el cerebro de Nexa, Chat, Memory, Knowledge, Web Intelligence, Qwen, Forge ni el Hosted Web Agent existente. Amplía el Hosted Web Agent para que la Web pueda enviar trabajos de desarrollo reales al PC.

## Lo nuevo

### 1. Local Developer Runtime
Nuevo archivo:

`lib/developer-runtime-v250.js`

Expone herramientas locales bajo tipos `developer.*`.

### 2. Terminal controlada
Herramienta:

`developer.terminal.run`

Características:
- `spawn(..., shell:false)`; no usa PowerShell/cmd como shell genérico.
- comandos permitidos por allowlist.
- bloquea `node -e`, `python -c`, `php -r` y ejecución inline equivalente.
- `cwd` debe estar dentro de Developer Allowed Roots.
- timeout y límite de salida.
- variables de entorno con nombres sensibles (TOKEN/SECRET/PASSWORD/API_KEY/AUTH/etc.) no se pasan al proceso hijo.
- secretos reconocibles en stdout/stderr se redactan antes de enviarse a la Web o persistirse.

Perfil inicial permitido:

`node, npm, php, composer, python, python3`

Git se ejecuta por su herramienta dedicada `developer.git.run`.

> Nota de seguridad: npm/composer/scripts del propio proyecto son código del proyecto y pueden ejecutar acciones. El Developer Runtime reduce superficie de ataque, pero no pretende ser una sandbox de sistema operativo.

### 3. Browser Agent real
Herramienta:

`developer.browser.run`

Utiliza un `BrowserWindow` real de Electron en segundo plano con:
- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- `webSecurity: true`
- ventanas nuevas bloqueadas
- sesión persistente separada `persist:nexa-developer-browser`

Acciones soportadas:
- `goto`
- `click`
- `type`
- `select`
- `press`
- `wait`
- `waitfor`
- `asserttext`
- `asserturl`
- `extract`
- `screenshot`

Devuelve título, URL, texto visible, formularios, links, botones, imágenes, consola y errores de carga. Las capturas producidas por el Browser Agent se suben a la Web mediante el endpoint de imágenes que ya usa Nexa.

No existe una herramienta de JavaScript arbitrario expuesta al Developer Web.

### 4. Code Index / Project Intelligence
Herramientas:

`developer.semantic.index`
`developer.semantic.search`

Crea un índice estructural/symbol-aware persistente del proyecto:
- archivos de código
- funciones
- clases
- IPC channels
- includes/imports/requires
- tablas/indexes SQL
- DOM ids/forms
- selectores CSS
- grafo básico de dependencias relativas

Es un índice local de símbolos + búsqueda ponderada. **No usa embeddings/vector DB todavía.** Está diseñado como la primera capa rápida de selección de contexto antes de pedir archivos completos al modelo.

### 5. File Agent con guardrails
Herramientas:

`developer.file.list`
`developer.file.read`
`developer.file.write`
`developer.file.replace`
`developer.file.mkdir`
`developer.file.delete`

Incluye:
- Allowed Roots.
- bloqueo de escapes `../`.
- defensa adicional contra escapes mediante symlinks/junctions usando rutas reales.
- SHA-256 opcional antes de escribir para evitar sobrescribir un archivo que cambió.
- backups automáticos antes de write/replace/delete.
- bloqueo especial de `.env`, private keys, `.npmrc`, credentials/secrets JSON, etc.; requieren confirmación explícita.

### 6. Persistent Developer Jobs + Resume
Herramientas:

`developer.workflow.run`
`developer.job.list`
`developer.job.status`
`developer.job.resume`
`developer.job.cancel`

Cada workflow guarda estado después de cada paso. Si Nexa se cierra o el PC se reinicia, la Web puede consultar el job y pedir `resume`.

Los datos con claves sensibles (`password`, `token`, `secret`, `authorization`, etc.) **no se guardan en claro**. Si una tarea pendiente dependía de un secreto no persistido, Resume pide reenviar esa credencial en vez de guardarla localmente.

### 7. Security Scanner
Herramienta:

`developer.security.scan`

Revisión estática inicial para:
- posibles API keys/tokens hardcoded
- private keys
- `eval()`
- `innerHTML =`
- ejecución de shell desde PHP
- SQL potencialmente concatenado con input
- HTTP externo sin TLS

Los secretos detectados son redactados en el reporte.

### 8. Database Inspector + migraciones protegidas
Herramientas:

`developer.db.inspect`
`developer.db.migrate`

Inspector:
- SQLite `.sqlite/.sqlite3/.db`
- archivos `.sql`
- tablas, columnas, PK, índices y views

Migraciones vienen **OFF por defecto**. Para habilitarlas hay que cambiar configuración explícitamente y cada aplicación exige:

`confirm: "APPLY_DATABASE_MIGRATION"`

Antes de ejecutar crea backup y usa `BEGIN IMMEDIATE / COMMIT / ROLLBACK`.

### 9. Git local
Herramienta:

`developer.git.run`

Permitido inicialmente:
- status
- diff
- log
- branch
- show
- rev-parse
- add
- commit

`pull/push/fetch` existen pero **networkEnabled = false por defecto**. Hay que activarlos explícitamente.

### 10. Base de Deploy
La configuración ya tiene bloque `deploy`, pero viene **enabled:false** y v2.5.0 no expone todavía un deploy destructivo. La intención es conectar Staging/Production en una fase posterior después de probar Browser/Terminal/Resume.

## Configuración local

La primera vez que corre, Nexa crea automáticamente:

`D:\LocalAI\NexaAI\HostedWeb\DeveloperRuntime\developer.json`

si existe `D:\LocalAI`. En otro equipo usa el `userData` de Electron.

Allowed Roots iniciales en Windows:
- `...\DeveloperRuntime\Projects`
- `D:\LocalAI`
- `D:\Projects`
- `%USERPROFILE%\Documents\NexaProjects`

Los cambios sensibles de configuración requieren:

`confirm: "ALLOW_NEXA_DEVELOPER_RUNTIME"`

## Integración Hosted Web

`lib/hosted-web-agent-v203.js` conserva heartbeat, worker watchdog, Chat y Forge existentes y agrega dispatch para `developer.*`.

El heartbeat/dashboard ahora informa:
- Developer enabled/off
- Allowed Roots
- Terminal disponible
- Browser Agent disponible
- Git/DB/Deploy state
- Developer config path

Los jobs Developer reciben hasta 2 horas antes del watchdog general, pueden cancelarse y reportan eventos `developer:progress` / `developer:artifact`.

## Importante para Nexa Web

Este update hace que el **software local quede listo para ejecutar** las herramientas. Nexa Web v2.4.0 ya tiene Chat Developer, pero todavía necesitaremos habilitar en la Web el enrutamiento de las herramientas que deben ejecutarse en el PC (`developer.browser.run`, `developer.terminal.run`, etc.). Ese puente Web es un cambio pequeño separado y **no requiere otro rebuild del EXE**.

## Instalación

1. En Nexa App Builder Pro abre el proyecto existente **Nexa IA**.
2. Crea una nueva Manual Delivery.
3. Sube `Nexa-AI-v2.5.0-DEVELOPER-RUNTIME-BIG-UPDATE.zip`.
4. Confirma que se preservan exactamente las rutas `lib/...` y `scripts/...`.
5. Apply staged files una vez.
6. Ejecuta Local build validation.
7. Sólo si queda verde: **Push to GitHub & Build**.
8. Instala el nuevo Windows build.

No subas este ZIP como proyecto nuevo.

## Archivos del update

Modificados:
- `package.json`
- `nexa.project.json`
- `lib/hosted-web-agent-v203.js`
- `scripts/validate-v203.js`

Nuevos:
- `lib/developer-runtime-v250.js`
- `scripts/validate-v250.js`
- `scripts/test-v250-developer-runtime.js`
- `README-V2.5.0.md`
- `UPDATE-MANIFEST-V2.5.0.json`

## Validación realizada antes de empaquetar

- JavaScript syntax de archivos nuevos/modificados: PASS.
- Developer Runtime integration validator: PASS.
- Hosted Web v2.0.3+ compatibility validator: PASS.
- Hosted Web sync tests existentes: PASS.
- Developer Runtime tests: PASS.
- file write/read/replace: PASS.
- SHA guard / Allowed Root traversal protection: PASS.
- symlink/junction escape guard: validado en plataforma compatible.
- inline terminal execution block: PASS.
- semantic/symbol index + search: PASS.
- security scanner redaction: PASS.
- sensitive-file guard: PASS.
- persistent workflow + status + resume: PASS.
- SQLite inspector usando `node:sqlite`: PASS en el entorno de prueba.

El Browser Agent Electron no puede ejecutarse de extremo a extremo en el contenedor Linux actual sin lanzar el runtime Electron gráfico. Su implementación se valida estáticamente aquí; el build Windows/UI smoke de GitHub y la primera prueba instalada son la validación runtime real.

## Rollback

El update es una capa aditiva. Para volver al estado previo:
- restaurar `package.json`, `nexa.project.json`, `lib/hosted-web-agent-v203.js` y `scripts/validate-v203.js` de la versión anterior;
- retirar los tres archivos v2.5.0 nuevos de Runtime/Test/Validator.

No modifica la base de conversaciones, Memory, Knowledge ni datos de usuario durante la instalación.
