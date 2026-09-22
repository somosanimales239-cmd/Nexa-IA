## 1.5.0
- Added Nexa AI Browser Bridge: a versioned HTTP API bound to `127.0.0.1:32145`.
- Added persistent pairing-token authorization and Settings controls to copy/show/regenerate the token.
- Added SQLite `browser_captures` and `browser_commands` tables without replacing existing knowledge/memory.
- Chrome Browser Bridge extension can save a selection, a readable page, or lightweight memory directly to the computer.
- Browser captures are deduplicated, source-traced and stored as `PARTIAL` knowledge by default.
- Added a future browser-command channel so later browser-navigation work can evolve primarily in the extension/API protocol.
- Added end-to-end local API validation covering auth, objectives, capture persistence, deduplication, memory and command queue.
- Preserved Nexa AI 1.4.0 research/applicability improvements and all existing UI/Ollama features.
