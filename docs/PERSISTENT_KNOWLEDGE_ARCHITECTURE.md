# Nexa AI 1.3.0 — Persistent Knowledge Architecture

## Separation of model and learned knowledge

Nexa AI keeps model weights separate from learned/user-supplied knowledge. The persistent structured database is stored as `nexa-knowledge.db` inside the Nexa data directory. This allows the same knowledge base to be reused with `gpt-oss:20b`, a future 120B model, or another local model without retraining or migrating model weights.

## Persistent SQLite database

Tables:
- `knowledge_objectives`: structured learning/research objectives.
- `objective_topics`: expected knowledge and state (`VERIFIED`, `PARTIAL`, `MISSING`, `CONFLICTING`, `OUTDATED`, `NOT VERIFIED`).
- `knowledge_entries`: versioned, active/inactive knowledge records.
- `knowledge_sources`: source URLs, titles, type, access date and traceability fields.
- `knowledge_entry_sources`: many-to-many source evidence links.
- `knowledge_relations`: relationships between knowledge entries.
- `research_runs`: auditable Internet-research attempts.

The database runs in WAL mode and does not live inside Ollama model files.

## Automotive objective template

Creating an Automotive objective automatically creates the baseline systems from `KNOWLEDGE_AUTOMOTIVE_POLICY.md` as `MISSING`. Empty topics mean that the knowledge is expected but has not yet been found or verified.

## Internet research flow

`LOCAL -> SEARCH -> VERIFY -> STORE -> ANSWER`

1. Search the structured local SQLite knowledge and document libraries first.
2. When configured and one objective is active in a chat, Nexa may search the web if local structured knowledge is insufficient.
3. Web results are ranked by source class (OEM, Government, Technical, Secondary).
4. The local Ollama model receives only bounded source excerpts and must return structured JSON validation.
5. Critical automotive data is not promoted to `VERIFIED` without sufficiently strong source evidence.
6. Stored records retain source metadata and confidence.
7. A newer version does not delete the prior version; the old record becomes inactive and remains traceable.

## Manual “Guardar en conocimiento”

The chat action writes a real row to `nexa-knowledge.db`. Manual chat knowledge is initially `PARTIAL`; it is not falsely promoted to verified technical knowledge just because it was saved from a conversation.

## Copyright

Nexa stores summarized facts/structured knowledge and source traceability from web research. It does not intentionally persist entire protected pages as a substitute for the original source.
