# Nexa AI v1.8.9 — GitHub Actions Build Fix

This hotfix corrects the failure in GitHub Actions run 36284953546.

## Exact failure
The v1.8.9 build correctly uses:
- package version: 1.8.9
- Electron entry: main-v189.js

But the inherited v1.8.8 validator still required exactly:
- package version: 1.8.8
- Electron entry: main-v188.js

So the application validations and UI smoke passed, but `npm run build:win` failed when it executed the inherited v1.8.8 validator a second time.

## Fix
- `scripts/validate-v188.js` now validates v1.8.8 as a reusable base runtime.
- It accepts a newer Electron entry when that entry explicitly chains to `main-v188.js`.
- It still validates the v1.8.8 runtime, visual evaluator, reference system and electron-builder inclusion.
- `scripts/validate-v189.js` now separately enforces version 1.8.9 and entry `main-v189.js`.

No ComfyUI, Qwen, reference consistency, prompt compiler, retry or renderer behavior was changed by this build fix.
