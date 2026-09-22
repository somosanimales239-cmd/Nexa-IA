# Nexa AI 1.6.0 — Persistent Knowledge Architecture

## Separation of model and learned knowledge

Nexa keeps model weights separate from learned/user-supplied knowledge. Structured durable knowledge and automated research state live in `nexa-knowledge.db`. The same database can be reused with `gpt-oss:20b`, a future 120B model, or another local model.

## Persistent SQLite database

Core tables include:
- `knowledge_objectives` — structured learning/research objectives.
- `objective_topics` — expected knowledge and state (`VERIFIED`, `PARTIAL`, `MISSING`, `CONFLICTING`, `OUTDATED`, `NOT VERIFIED`).
- `knowledge_entries` — versioned active/inactive knowledge records.
- `knowledge_sources` / `knowledge_entry_sources` — source traceability.
- `knowledge_relations` — relationships between knowledge entries.
- `research_runs` / `research_evidence` — auditable research attempts and evidence.
- `browser_captures` — manual Browser Bridge ingestion.
- `browser_commands` — extension worker command/result queue.
- `knowledge_factory_curricula` — master make/model/year-range research curricula.
- `knowledge_factory_years` — per-year discovery/research progress.
- `knowledge_factory_configs` — distinct technical configurations linked to Automotive objectives.

The database uses WAL mode and is independent of Ollama model files.

## Auto Knowledge Factory

A curriculum such as `Toyota Corolla / US / 1969–2027` seeds each year in the queue. For every year:

1. Gather bounded source evidence (Browser Bridge worker preferred when online; direct research fallback otherwise).
2. Ask the local model to extract only supported technical configurations for the exact year/market.
3. Create/reuse an Automotive objective for each configuration.
4. Research the normal Automotive baseline topics using the existing source ranking/applicability/validation rules.
5. Recalculate coverage. `VERIFIED` counts fully; `PARTIAL` contributes partial coverage.
6. At the configured threshold, mark the configuration complete and continue.
7. Repeated failures become `NEEDS_REVIEW` so the master queue can continue.

## Internet research flow

`LOCAL -> SEARCH -> VERIFY -> STORE -> ANSWER`

Factory discovery adds a preliminary catalog pass:

`CATALOG -> DISCOVER -> OBJECTIVES -> LOCAL/SEARCH -> VERIFY -> STORE -> COVERAGE -> NEXT`

Web evidence is never trusted merely because it exists on a page. Exact make/model/year/market and relevant engine/transmission applicability remain part of validation.

## Browser Worker

The Chrome extension is an Internet transport, not a database. It can receive a bounded research command through API v1, fetch search/page text under extension permissions, and return source evidence. Nexa validates and writes durable knowledge locally.

## Manual “Guardar en conocimiento”

The chat action writes a real row to `nexa-knowledge.db`. Manual chat knowledge is initially `PARTIAL`; it is not falsely promoted to verified technical knowledge simply because it was saved from a conversation.

## Copyright

Nexa should store summarized facts/structured knowledge and source traceability from research. It should not intentionally persist entire protected works as a substitute for the original source.
