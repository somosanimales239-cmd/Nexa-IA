## 1.6.0
- Added Auto Knowledge Factory for manufacturer/model/year-range curricula.
- A curriculum seeds the full year queue locally (for example Toyota Corolla US 1969–2027) and advances year by year without manual objective creation.
- Added a discovery pass that researches the exact year/market, extracts distinct technical configurations (generation, body, trims, engine, transmission, drivetrain), and creates/reuses Automotive objectives for each configuration.
- Added persistent SQLite factory tables for curricula, years, and technical configurations. Progress survives application restarts and does not live in model weights.
- Added coverage tracking per technical configuration and year. Nexa researches missing Automotive topics, verifies/stores results, then automatically advances to the next configuration/year.
- Added retry and NEEDS_REVIEW behavior so one difficult vehicle does not stop the entire master list.
- Activated the Browser Bridge API v1 command queue as a real browser worker transport for automatic web research. The extension heartbeats, polls commands, fetches research sources in Chrome, and returns evidence to Nexa for local validation/storage.
- Added Browser Bridge extension v1.1.0 with automatic worker toggle, alarms, web_research/fetch_url/open_url command support, and persistent pairing with API v1.
- Added the Toyota Corolla US 1969–2027 preset while keeping the factory generic for other makes/models/year ranges.
- Preserved existing chats, Memory, Knowledge Libraries, Browser captures, Persistent Knowledge, Fast/Light modes, Unity detection, logo, custom chat scrollbar and existing API v1 capture/memory endpoints.

## 1.5.0
- Added Nexa AI Browser Bridge: a versioned HTTP API bound to `127.0.0.1:32145`.
- Added persistent pairing-token authorization and Settings controls to copy/show/regenerate the token.
- Added SQLite `browser_captures` and `browser_commands` tables without replacing existing knowledge/memory.
- Chrome Browser Bridge extension can save a selection, a readable page, or lightweight memory directly to the computer.
- Browser captures are deduplicated, source-traced and stored as `PARTIAL` knowledge by default.
- Added a browser-command compatibility channel that 1.6.0 now uses for the automatic Browser Worker.
- Preserved Nexa AI 1.4.0 research/applicability improvements and all existing UI/Ollama features.
