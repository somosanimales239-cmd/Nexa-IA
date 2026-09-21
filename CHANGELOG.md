## 1.3.1
- Fixed Internet research failures caused by relying on a single DuckDuckGo HTML endpoint.
- Added multi-provider fallback search: DuckDuckGo HTML, DuckDuckGo Lite, Bing RSS, and Bing HTML.
- Added provider diagnostics to errors so SEARCH failures identify which provider was blocked or returned no results.
- Preserved persistent SQLite knowledge, source validation, custom chat scrollbar, transparent jump-to-bottom button and Nexa desktop logo.

# Changelog

## 1.3.0
- Added real persistent SQLite knowledge database: `nexa-knowledge.db`.
- Added structured Knowledge Objectives, including an Automotive template with 37 baseline systems/topics created as `MISSING`.
- Added knowledge status lifecycle: VERIFIED, PARTIAL, MISSING, CONFLICTING, OUTDATED and NOT VERIFIED.
- Added source traceability, confidence, versions, duplicate detection and research audit records.
- Added Internet research controls and manual “Completar faltantes” / topic research.
- Added local-first chat research: when one objective is attached to the chat and local knowledge is insufficient, Nexa can search, validate with the local model, persist validated knowledge and then answer.
- Added “Guardar en conocimiento” on chat messages; it writes to the SQLite database rather than only changing UI state.
- Preserved document Knowledge Libraries, chat memory, custom chat scrollbar, transparent “Ir al final” button and Nexa desktop logo.
- Knowledge remains outside model weights so future local models can reuse the same database.

## 1.2.6
- Added dedicated in-app chat scrollbar rail and draggable thumb.
- Kept the semi-transparent “Ir al final” button visible inside the chat viewport.
- Added visible installed-build version next to the Nexa AI brand.
