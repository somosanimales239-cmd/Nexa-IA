# Nexa AI v1.3.0

Nexa AI is a Windows Electron application for running a local Ollama model with persistent chats, user memory, document Knowledge Libraries, structured persistent knowledge and source-traced Internet research.

## Core local architecture

- Ollama endpoint defaults to `http://127.0.0.1:11434`.
- Default model: `gpt-oss:20b`.
- Existing fast/light GPU profiles remain available.
- Chats and lightweight user memories remain in the local Data area.
- Imported books/manuals remain in the local Knowledge area.
- Structured learned knowledge is stored in `Data/nexa-knowledge.db` (SQLite), outside model weights.
- The same database can be used by a future 120B or other local model.

## Persistent Knowledge 1.3

The Knowledge panel now supports:
- Automotive and general/science objectives.
- Automatic Automotive baseline structure with missing/verified status tracking.
- Manual research by topic.
- “Completar faltantes” in small controlled batches.
- Optional automatic web research when the active chat has exactly one objective and local structured knowledge is insufficient.
- Source ranking and local-model validation before storage.
- Confidence and verification state.
- Source URL/title/type/access date traceability.
- Version preservation instead of destructive overwrite.
- “Guardar en conocimiento” from any chat message.

## Data locations

Preferred Windows paths when `D:\LocalAI` exists:

- `D:\LocalAI\NexaAI\Data\nexa-data.json` — chats, settings and lightweight memory.
- `D:\LocalAI\NexaAI\Data\nexa-knowledge.db` — structured persistent knowledge, sources, objectives and research history.
- `D:\LocalAI\NexaAI\Knowledge\` — imported books/manuals and document search indexes.
- `D:\LocalAI\Models\` — Ollama model files, separate from knowledge.

## Important semantics

Adding information to Knowledge is not model fine-tuning. It is persistent, source-aware retrieval knowledge. This distinction lets the user upgrade or replace the underlying model without losing learned material.

## Build

The repository includes `.github/workflows/nexa-windows-build.yml` for the Nexa App Builder workflow and retains the branded installer/desktop icon under `assets/icon.ico`.
