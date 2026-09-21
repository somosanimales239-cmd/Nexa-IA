# Nexa AI 1.0.0

Nexa AI is a Windows desktop control center for a **local Ollama + gpt-oss:20b** installation. It is designed around the tested machine profile used for the first release: Windows 10, 32 GB RAM and an NVIDIA GTX 1070 Ti 8 GB.

## What version 1.0 includes

- Local streaming chat through `http://127.0.0.1:11434`.
- Persistent chat history with rename, search and delete.
- Persistent local memory independent from model weights; memories can be enabled/disabled or saved directly from a message.
- **Fast mode**: lets Ollama automatically choose GPU offload for maximum speed.
- **Light mode**: sends `num_gpu` with a configurable layer count (default 6) so Unity can keep more VRAM.
- Optional automatic Fast/Light switching when Unity is detected.
- RAM, AI RAM, Unity RAM, total VRAM, AI VRAM, other VRAM, GPU utilization and temperature monitoring.
- Start Ollama locally using the configured `ollama.exe` and `OLLAMA_MODELS` path.
- Warm/load the selected model and unload it to release RAM/VRAM.
- Default paths match the current local setup:
  - Ollama: `D:\LocalAI\Ollama\ollama.exe`
  - Models: `D:\LocalAI\Models`
  - Nexa data: `D:\LocalAI\NexaAI\Data` when `D:\LocalAI` exists.
- No OpenAI/Anthropic/Google cloud AI endpoint is used by the app.

## Important performance behavior

Fast mode omits `num_gpu`, preserving Ollama's automatic behavior. On the tested machine this previously loaded approximately 6 GB of VRAM for gpt-oss:20b.

Light mode defaults to `num_gpu = 6`. This is an initial conservative profile intended to leave more VRAM to Unity. The live System panel shows actual VRAM usage so the layer number can be calibrated without creating another model copy.

Changing modes unloads the currently loaded model. The next prompt or **Load 20B** action reloads the same model using the new profile. The 13 GB model is never duplicated.

## Local data

Chats, settings and memories are stored in `nexa-data.json`. The app writes atomically and keeps a backup copy. Model weights remain managed by Ollama and are not copied into the Nexa application.

## Build

The repository follows the Nexa App Builder Pro Electron delivery contract.

```powershell
npm ci
npm run validate
npm run ui:smoke
npm run build:win
```

Windows delivery targets:

- NSIS installer
- Portable EXE
- Windows ZIP

The included `.github/workflows/nexa-windows-build.yml` is the Nexa App Builder Pro Windows workflow.
