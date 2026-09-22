# Nexa AI v1.6.0

Nexa AI is a Windows Electron application for a local Ollama model with persistent chats, lightweight user memory, document Knowledge Libraries, structured SQLite knowledge, controlled Internet research, a Chrome Browser Bridge, and an Auto Knowledge Factory.

## What Auto Knowledge Factory does

Create one curriculum such as:

`Toyota / Corolla / 1969–2027 / US / 85% coverage`

Nexa creates the entire year queue locally. For each year it performs a discovery pass, uses available web evidence to identify the exact technical configurations sold for that make/model/year/market, creates or reuses Automotive objectives, researches missing technical topics, verifies/stores the knowledge in SQLite, and then advances automatically.

The factory state is persistent. Closing Nexa does not erase the curriculum or learned knowledge. A difficult configuration is retried and can be marked `NEEDS_REVIEW` so the rest of the master list can continue.

## Factory flow

`CATALOG -> DISCOVER YEAR -> TECHNICAL CONFIGS -> OBJECTIVES -> RESEARCH -> VERIFY -> STORE -> COVERAGE CHECK -> NEXT CONFIG/YEAR`

A technical configuration is separated by fields such as generation, body style, engine, transmission and drivetrain. Trims that share the same mechanical configuration can be grouped together.

The included preset creates **Toyota Corolla / US / 1969–2027**. The form is generic, so the same system can later create Honda Civic, Toyota Camry, Ford F-150, etc.

## Core local architecture

- Ollama endpoint defaults to `http://127.0.0.1:11434`.
- Default model: `gpt-oss:20b`.
- Fast/Light GPU profiles remain available.
- Chats and lightweight user memories remain in the local Data area.
- Imported books/manuals remain in the local Knowledge area.
- Structured learned knowledge is stored in `Data/nexa-knowledge.db` (SQLite), outside model weights.
- Factory curricula/queues/progress are also stored in the same persistent SQLite database.
- The same knowledge can be reused by a future 120B or another local model.

## Browser Extension Bridge v1.1.0

Nexa AI exposes API v1 at:

`http://127.0.0.1:32145/api/v1`

The Chrome extension remains a transport layer, not the memory database. Manual page/selection capture still works. In 1.6.0 the extension can additionally run as a Browser Worker: it heartbeats to Nexa, polls the local command queue, performs bounded web research/fetches in Chrome, and returns source evidence to Nexa. Nexa performs the validation and persistent storage on the computer.

If the extension worker is online, Auto Knowledge Factory prefers it for web research. If it is unavailable, the existing direct web-research fallback remains available.

The API server listens on loopback only and data endpoints require the local pairing token.

## Persistent Knowledge

The Knowledge panel supports:
- Automotive and General/Science objectives.
- Automatic Automotive baseline topics.
- `VERIFIED`, `PARTIAL`, `MISSING`, `CONFLICTING`, `OUTDATED`, `NOT VERIFIED`.
- Manual research by topic and bounded “Completar faltantes”.
- Source ranking and local-model validation.
- Source traceability and preserved versions.
- “Guardar en conocimiento” from chat messages.
- Browser-captured knowledge from the Chrome extension.
- Auto Knowledge Factory curricula and progress.

## Preferred Windows data locations

- `D:\LocalAI\NexaAI\Data\nexa-data.json` — chats, settings and lightweight memory.
- `D:\LocalAI\NexaAI\Data\nexa-knowledge.db` — objectives, structured knowledge, sources, web evidence, browser captures and factory queues/progress.
- `D:\LocalAI\NexaAI\Data\nexa-browser-bridge.json` — local Browser Bridge pairing configuration.
- `D:\LocalAI\NexaAI\Knowledge\` — imported books/manuals and indexes.
- `D:\LocalAI\Models\` — Ollama model files.

## Important semantics

Adding information to Knowledge is persistent retrieval knowledge, not model-weight fine-tuning. This is intentional: a different local model can immediately use the same external memory.

Factory discovery never treats a web page as automatically `VERIFIED`. Source evidence is passed to the local model for structured extraction/validation and the existing research rules determine `PARTIAL` versus `VERIFIED`.

## Chrome extension

Source folder: `browser-extension/`

Standalone distribution: `Nexa-AI-Browser-Bridge-Chrome-v1.1.0.zip`

Install it through `chrome://extensions` -> Developer mode -> Load unpacked, pair it with the token shown in Nexa Settings, and leave **Browser Worker** enabled for automatic Factory research.

## Build

The repository keeps `.github/workflows/nexa-windows-build.yml` for the Nexa App Builder Windows build and the branded application icon at `assets/icon.ico`.

Run `npm run validate` before packaging.
