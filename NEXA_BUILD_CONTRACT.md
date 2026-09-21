# NEXA-01 — Complete Local AI Control Center

This first release is intentionally one complete module rather than a chain of partial versions.

## Scope

Build **Nexa AI 1.0.0**, a Windows Electron application that controls the existing local Ollama installation and existing `gpt-oss:20b` model without duplicating model weights.

## Required capabilities delivered

1. Local streaming chat.
2. Durable conversations: create, select, rename, search and delete.
3. Durable local memory with enable/disable, delete and save-from-message.
4. Fast mode using Ollama automatic GPU offload.
5. Light mode using configurable `num_gpu`, default 6.
6. Mode switch unloads the current model so the next load uses the new distribution.
7. Local Ollama start, model warm/load and model unload controls.
8. Live RAM/VRAM/GPU/temperature monitor.
9. Unity detection plus optional automatic mode switching.
10. Configurable model name, Ollama API, executable path, model folder, context, GPU layers and keep-alive.
11. Offline-first behavior with no cloud AI API dependency.
12. Installer, Portable and ZIP delivery through the existing Nexa Windows workflow.

## Non-goals for 1.0

- Training or fine-tuning model weights.
- Web browsing or external tool agents.
- Remote control of Windows/Unity.
- Cloud sync of chats or memories.

Those capabilities can be added later on top of this stable local control layer without replacing the model or the memory store.
