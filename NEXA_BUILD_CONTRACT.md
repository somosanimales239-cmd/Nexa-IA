# Nexa AI 1.6.0 Build Contract

Update **Nexa AI to 1.6.0** as one coherent update from the 1.5.0 Browser Bridge baseline. Preserve all existing behavior unless explicitly extended below.

## Non-negotiable persistent data

Do not delete, relocate, reset or replace the user's existing:
- chats;
- lightweight Memory;
- Knowledge Libraries;
- `nexa-knowledge.db` entries/objectives/sources/evidence/browser captures;
- Browser Bridge pairing configuration.

SQLite migration must be additive. Factory tables are new persistent metadata and queue state.

## Auto Knowledge Factory

Required persistent entities:
- curricula (make/model/year range/market/completion threshold/status);
- years (discovery/research state, coverage, retry/error state);
- technical configurations (generation/body/trims/engine/transmission/drivetrain/objective link/coverage/status).

Required behavior:
- seed all requested years immediately;
- discover exact year/market configurations from evidence;
- create/reuse Automotive objectives;
- research one missing topic at a time using existing verification/storage rules;
- advance automatically when the coverage threshold is reached;
- retry failures; mark `NEEDS_REVIEW` after bounded retries; continue with subsequent work;
- resume a previously RUNNING curriculum after restart when auto-continue is enabled.

## Browser Bridge API v1 compatibility

Keep existing API v1 capture/memory/auth endpoints compatible. Add/use:
- `POST /api/v1/worker/heartbeat`;
- `GET /api/v1/commands/next`;
- `POST /api/v1/commands/result`.

Browser worker results are evidence. Nexa remains responsible for validation and writes to SQLite.

## Chrome extension v1.1.0

Keep Manifest V3, local pairing token, manual Knowledge/Memory capture, and add automatic Browser Worker polling with alarms. The extension may fetch web sources needed by a queued Nexa research command, but must not become the durable memory store.

## Validation

`npm run validate` must pass before packaging. Keep the Windows GitHub workflow stale/missing lock recovery so package-lock drift cannot recreate the previous dependency-lock failure.
