# NEXA AI 1.3.2 — ONE-SHOT APP BUILDER PROMPT

Repository: `somosanimales239-cmd/Nexa-IA`

Apply the complete **NEXA-03 Persistent Knowledge + Verified Web Research** update as one coherent build. Do not split into throwaway partial versions.

Use the exact project source in this package as the desired implementation. Preserve all existing working behavior.

## Required result

Nexa AI 1.3.2 must keep its local Ollama architecture while adding a real model-independent persistent SQLite knowledge database and optional source-traced Internet research.

### Persistent knowledge

- Create/use `D:\LocalAI\NexaAI\Data\nexa-knowledge.db` when `D:\LocalAI` exists, otherwise userData fallback.
- Keep model files in `D:\LocalAI\Models`; never put learned knowledge into model weights.
- A future 120B model must immediately reuse the same database.
- “Guardar en conocimiento” must create/version a real SQLite record.

### Objectives

Support `Automotive` and `General / Science / Other` objectives.

For Automotive, create the baseline structure from `docs/KNOWLEDGE_AUTOMOTIVE_POLICY.md` with all new topics initially `MISSING`.

Track `VERIFIED`, `PARTIAL`, `MISSING`, `CONFLICTING`, `OUTDATED`, `NOT VERIFIED`.

### Internet research

When enabled:

`LOCAL -> SEARCH -> VERIFY -> STORE -> ANSWER`

- search local structured DB and Knowledge Libraries first;
- if insufficient and exactly one objective is active in the chat, research the web;
- rank OEM/Government above technical/secondary sources;
- validate exact applicability using the local Ollama model;
- keep URL/title/type/access date/confidence/status;
- preserve old knowledge versions;
- do not store full protected pages as a substitute for the source.

### Knowledge UI

Keep Document Libraries and add:

- database stats/path;
- create objective form;
- attach objective to chat;
- topic research button;
- `Completar faltantes` batch action;
- research progress state;
- combined persistent/document local search.

### Settings

Add:

- Internet research toggle;
- automatic research-on-missing toggle;
- maximum web sources;
- batch size.

### Preserve

Preserve the custom visible chat scrollbar and semi-transparent `Ir al final` button, new Nexa AI logo/icon, chats, memory, document libraries, Fast/Light modes, Unity detection and Windows packaging.

### Validation

Run `npm run validate`. It must include the persistent knowledge test and all baseline tests. Then run the existing Windows workflow to completion and deliver Installer EXE, Portable EXE and ZIP.

Application version: `1.3.2`.
