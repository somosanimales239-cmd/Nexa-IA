# Nexa AI v1.8.1 — Visual Review Bridge

This replaces the failed v1.8.0 startup bootstrap.

The v1.8.0 error happened because main-v180.js tried to patch main.js source text during application startup and required an exact text anchor. v1.8.1 does not patch main.js text.

v1.8.1 wraps the Electron image IPC handler. The existing image generator remains intact. Every returned image is then sent to qwen2.5vl:3b for review. Failed images are repaired and retries are rendered directly through ComfyUI, up to three attempts. The best evaluated result is returned.

Required model:
qwen2.5vl:3b

Expected visible flow:
Nexa Visual: comprobando qwen2.5vl:3b
Nexa Visual: llamando Qwen2.5-VL 3B
Nexa Visual rechazó ... reparando
Renderizando retry 2/3
Nexa Visual APROBÓ ...

Runtime trace:
D:\LocalAI\NexaAI\Data\visual-review-v181.log

Files to update/add:
package.json
nexa.project.json
main-v181.js
lib/visual-review-v181.js
scripts/validate-v181.js

Keep the existing main.js, preload.js, src folder and all other stable project files unchanged.
