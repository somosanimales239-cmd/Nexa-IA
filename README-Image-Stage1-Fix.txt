Nexa AI v1.7.0 - Image Stage 1 - Build 101 validation fix

This package is based exactly on commit d29ab85570d6efd5b2ec94738337448c07b6d7a3 from the failed GitHub Actions run 36211927403.

Fixes included:
- Removes the renderer pattern that failed the App Builder compatibility test.
- Keeps image generation Stage 1 intact.
- Restores the chat completion hotfix: 8 recent messages, minimum 12288 context, 4096 visible output tokens, think false.
- Keeps source metadata internally but removes the visible "Fuentes usadas" row from chat.
- No changes to Browser Bridge, Knowledge DB, Auto Knowledge Factory, image UI, ComfyUI integration, or download/lightbox behavior beyond the validation fix.

Files in this package:
- main.js
- preload.js
- src/app.js
- src/app.css
- src/index.html
