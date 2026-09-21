# NEXA AI 1.0.0 — ONE-SHOT APP BUILDER PROMPT

Create and finish a real Windows Electron desktop application named **Nexa AI** in repository:

`somosanimales239-cmd/Nexa-IA`

This is a single complete first release. Do not split it into many versions or optional phases.
Use exactly one implementation contract/module:

`NEXA-01-complete-local-ai-control-center`

Use the existing Nexa Electron starter and existing Windows delivery workflow. Do not create a second repository. Do not replace the build system.

## Product goal

Nexa AI is the local desktop control center for the user's existing Ollama installation and existing `gpt-oss:20b` model. It must manage local chats, local memory, Ollama engine/model state, and Fast/Light CPU-GPU profiles. It must remain useful with Internet disconnected.

Tested machine/setup to use as first-release defaults:

- Windows 10 Pro
- Intel i7-9700K
- 32 GB RAM
- NVIDIA GTX 1070 Ti 8 GB
- Ollama executable: `D:\LocalAI\Ollama\ollama.exe`
- Ollama models: `D:\LocalAI\Models`
- model: `gpt-oss:20b`
- local API: `http://127.0.0.1:11434`
- context: 4096

Do not copy or duplicate the 13 GB model into Nexa AI. Nexa AI controls the one model already owned by Ollama.

## Required app shell

Professional dark desktop UI with three areas:

1. Left sidebar: New chat, chat search, persistent chat list, System / Memory / Settings navigation.
2. Center: current chat, model/engine state, Fast/Light selector, streaming messages, prompt composer, Send and Stop.
3. Right inspector: live system monitor plus Memory and Settings panels.

## Chat requirements

- Local streaming chat through Ollama `/api/chat`.
- Create, select, rename, search and delete chats.
- Persist chats after app restart.
- Stop an active generation.
- Save any user/assistant message into Memory.
- No cloud AI API fallback.
- Show a useful offline/local empty state.
- Keep renderer sandboxed: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.

## Memory requirements

Memory is NOT model training.
Store durable memories separately from model weights.

- Add memory manually.
- Save a message as memory.
- Enable/disable each memory.
- Delete memory.
- Global toggle to include/exclude memories from answers.
- When enabled, inject a bounded list of memories as a system message before relevant local chat history.
- Store chats/settings/memories locally with atomic writes and a backup file.
- Prefer `D:\LocalAI\NexaAI\Data` when `D:\LocalAI` exists; otherwise use Electron userData.

## Performance modes

Use the SAME `gpt-oss:20b` model for both modes.

### FAST / RÁPIDO

- Omit `num_gpu` so Ollama automatically chooses GPU offload.
- This is the maximum-speed profile when Unity is not competing for VRAM.

### LIGHT / LIGERO

- Send `num_gpu` through Ollama options.
- Default Light value: `6` GPU layers.
- The value must be editable in Settings from 0 to 99.
- The live VRAM monitor is used to calibrate this later without changing app architecture.

When the user changes Fast/Light mode:

- save the selected profile;
- unload the currently loaded model;
- the next prompt/load must reload the same model with the new profile;
- never download a second model copy.

Add an optional setting (OFF by default) to automatically switch to Light when `Unity.exe` is detected and return to Fast when Unity closes.

## Ollama engine controls

- Check API status using `/api/tags`.
- Check loaded models using `/api/ps`.
- Start Ollama using configured `ollama.exe serve` with environment variable `OLLAMA_MODELS` pointing to configured model folder.
- Warm/load the selected model locally.
- Unload model to release RAM/VRAM.
- All paths editable in Settings.
- All failures must be shown as friendly local errors; no fake success state.

## Hardware monitor

Refresh about every 2.5 seconds and display:

- total / used / free system RAM;
- `llama-server` RAM;
- Unity RAM;
- total NVIDIA VRAM used/total;
- selected Ollama model VRAM from `/api/ps` `size_vram`;
- other VRAM usage = total GPU usage minus selected model VRAM;
- GPU utilization;
- GPU temperature;
- Unity detected / not detected;
- active Fast/Light profile;
- Ollama online/offline and selected model loaded/unloaded.

Use `nvidia-smi` when available. Do not crash when NVIDIA tooling is unavailable.

## Settings

Persist editable settings for:

- model name;
- Ollama base URL;
- ollama.exe path;
- model folder path;
- context length;
- Light GPU layer count;
- keep_alive;
- auto Unity mode;
- include memories.

Provide an action to open the local Nexa data folder.

## Security / privacy

- No generic `ipcRenderer` exposed to the renderer.
- Preload exposes only narrow typed actions.
- External URLs must open outside the app.
- Do not add OpenAI, Anthropic, Gemini or any other cloud AI endpoint.
- The app must still chat after Internet is disconnected as long as Ollama and the model are local.

## Delivery and validation

Product name: `Nexa AI`
Version: `1.0.0`
App ID: `com.nexa.localai`

Build targets required:

- Windows NSIS Installer EXE
- Windows Portable EXE
- Windows ZIP

Tests must verify at minimum:

- Electron entry graph and required files;
- security defaults;
- local Ollama routes `/api/chat`, `/api/tags`, `/api/ps`;
- gpt-oss:20b default;
- Fast/Light execution logic including real `num_gpu` use in Light mode;
- persistent chats;
- persistent memory and memory system prompt;
- New/Send/Stop/Start/Load/Unload real controls;
- nvidia-smi monitor and Unity detection;
- absence of hard-coded cloud AI endpoints;
- UI smoke loads without preload or renderer failure.

Run and pass:

- `npm run validate`
- `npm test`
- `npm run ui:smoke`

Then continue automatically through the existing Nexa Windows workflow until Installer, Portable and ZIP are verified artifacts. Do not mark the task completed at workflow dispatch time.

## Do not do

- Do not train/fine-tune model weights in v1.
- Do not add web browsing or remote agents in v1.
- Do not add Windows/Unity remote control in v1.
- Do not duplicate the Ollama model.
- Do not create placeholder buttons or fake metrics.
- Do not split this into multiple implementation modules.
