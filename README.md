# Nexa AI v1.5.0

Nexa AI is a Windows Electron application for a local Ollama model with persistent chats, lightweight user memory, document Knowledge Libraries, structured SQLite knowledge, controlled Internet research and a Chrome Browser Bridge.

## Core local architecture

- Ollama endpoint defaults to `http://127.0.0.1:11434`.
- Default model: `gpt-oss:20b`.
- Fast/Light GPU profiles remain available.
- Chats and lightweight user memories remain in the local Data area.
- Imported books/manuals remain in the local Knowledge area.
- Structured learned knowledge is stored in `Data/nexa-knowledge.db` (SQLite), outside model weights.
- The same knowledge can be reused by a future 120B or another local model.

## Browser Extension Bridge

Nexa AI now exposes a versioned local API at:

`http://127.0.0.1:32145/api/v1`

The included Chrome extension can send a selected passage or a complete readable page directly to the computer. Nexa persists that capture in SQLite and creates searchable `PARTIAL` knowledge with the page URL and source metadata. The extension can also save selected text to lightweight Memory.

The extension itself is not the database. Reinstalling/updating the extension does not delete learned knowledge.

The pairing token is shown in Nexa AI → Settings → **Browser Extension Bridge**. Every data endpoint requires that token and the server listens on loopback only.

See `docs/BROWSER_EXTENSION_BRIDGE.md`.

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

## Preferred Windows data locations

- `D:\LocalAI\NexaAI\Data\nexa-data.json` — chats, settings and lightweight memory.
- `D:\LocalAI\NexaAI\Data\nexa-knowledge.db` — objectives, structured knowledge, sources, web evidence and browser captures.
- `D:\LocalAI\NexaAI\Data\nexa-browser-bridge.json` — local Browser Bridge pairing configuration.
- `D:\LocalAI\NexaAI\Knowledge\` — imported books/manuals and indexes.
- `D:\LocalAI\Models\` — Ollama model files.

## Important semantics

Adding information to Knowledge is persistent retrieval knowledge, not model-weight fine-tuning. This is intentional: a different local model can immediately use the same external memory.

Browser pages captured by the user begin as `PARTIAL` evidence. They are not automatically promoted to `VERIFIED` facts simply because a web page contained the text.

## Chrome extension

Source folder: `browser-extension/`

Standalone distribution: `Nexa-AI-Browser-Bridge-Chrome-v1.0.0.zip`

Install it through `chrome://extensions` → Developer mode → Load unpacked, then pair it with Nexa AI using the token shown in Settings.

## Build

The repository keeps `.github/workflows/nexa-windows-build.yml` for the Nexa App Builder Windows build and the branded application icon at `assets/icon.ico`.
