# NEXA-04 — Browser Bridge + Durable Local Learning API

Update **Nexa AI to 1.5.0** as one coherent update. Preserve every working feature from 1.4.0.

## Architectural rule

The Chrome extension is a transport/client. Durable learning stays on the computer.

```text
Chrome extension → local API v1 → Nexa desktop → nexa-knowledge.db
```

Do not make Chrome extension storage the source of truth.

## Stable API boundary

Nexa desktop must expose `http://127.0.0.1:32145/api/v1` and bind only to loopback.

All data endpoints require a locally generated pairing token. Settings must show API status, API URL, a masked token, copy/show controls and token regeneration.

Required endpoints:
- health;
- token verification;
- objectives;
- page/selection capture;
- recent captures;
- lightweight memory save;
- future browser command poll/result channel.

The API v1 capture contract should remain backward compatible so future extension improvements do not require rebuilding the desktop app for routine browser-side changes.

## Browser capture persistence

Schema must persist captures in SQLite, including URL, title, capture type, page text/selection, metadata, source, hash, status, confidence and associated knowledge entry.

Duplicate page/selection captures are detected by content hash.

Captured browser knowledge defaults to `PARTIAL` with source traceability. Never mark arbitrary page content `VERIFIED` merely because it was captured.

## Chrome extension

Manifest V3 extension must support:
- pair with local Nexa using token;
- list persistent objectives;
- save current selection to Knowledge;
- save readable current page to Knowledge;
- save selected text to lightweight Memory;
- context-menu actions for page/selection capture;
- standalone options page;
- Nexa branding.

Do not automatically record every page the user visits.

## Preserve

Preserve local Ollama chat, persistent chats, Memory, Knowledge Libraries, structured objectives, research engine, Fast/Light modes, Unity detection, monitors, custom chat scrollbar, `Ir al final`, logo and Windows packaging.

## Validation

`npm run validate` must include Browser Bridge API integration tests in addition to every existing validation.
