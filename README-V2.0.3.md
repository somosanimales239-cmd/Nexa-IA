# Nexa AI v2.0.3 — Hosted Web Sync Fix

This update fixes the case where the hosted site correctly shows **PC conectado** but the web UI still stays on **Forge ? / Ollama ?** and says it is waiting for Nexa.

## What changed
- Agent heartbeat now carries cached runtime status for Ollama and Forge.
- Hosted dashboard response is compacted to avoid shipping unrelated heavy data.
- Web status no longer depends entirely on the dashboard job to know if Ollama / Forge are online.
- Keeps all existing hosted-web commands, chat, attachments, memory, knowledge, and Forge generation.

## Expected behavior after both parts are updated
- `PC conectado` = hosted connector is alive.
- `Ollama online/offline` = real local Ollama status.
- `Forge online/offline` = real Forge API status.
- If dashboard sync fails, the web UI will show the actual error instead of pretending the PC is not connected.
