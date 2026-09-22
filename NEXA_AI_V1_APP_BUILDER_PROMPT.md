# NEXA AI 1.5.0 — ONE-SHOT APP BUILDER PROMPT

Repository: `somosanimales239-cmd/Nexa-IA`

Apply the complete **NEXA-04 Browser Bridge + Durable Local Learning API** update using the exact source in this package. Do not split it into partial rebuilds.

## Required architecture

Keep all durable knowledge outside model weights. Add a stable loopback API at `127.0.0.1:32145/api/v1` so the included Chrome extension can feed pages/selections into `nexa-knowledge.db`.

The extension must never be the primary memory store. A future 120B or other Ollama model must reuse the same local database.

## Security

- bind Browser Bridge to 127.0.0.1 only;
- require a generated pairing token for data endpoints;
- expose bridge status/token controls in Nexa Settings;
- keep captures `PARTIAL` by default;
- preserve source URL and traceability.

## Extension

Keep `browser-extension/` as a standalone Manifest V3 Chrome extension source. It must capture selection/page on explicit user action and send it through API v1. Do not auto-record ordinary browsing.

## Future browser control

Keep the API v1 browser command queue endpoints and SQLite table as the compatibility foundation for later direct navigation. Do not add uncontrolled autonomous browser actions in this version.

## Preserve

Preserve every existing Nexa feature: chats, Memory, Knowledge Libraries, persistent objectives, web research, Ollama control, Fast/Light GPU modes, Unity detection, system monitors, visible custom chat scrollbar, transparent jump-to-bottom button and Nexa logo.

## Validation

Run `npm run validate`; Browser Bridge validation and all prior validations must pass. Then use the existing Windows workflow for Installer, Portable and ZIP.

Application version: `1.5.0`.
