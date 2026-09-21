# NEXA-03 — Persistent Knowledge + Verified Web Research

Update **Nexa AI to 1.3.0** as one complete update. Preserve every working feature from prior versions, including the custom chat scrollbar, transparent jump-to-bottom button and branded desktop/installer icon.

## Core rule

The selected local LLM is replaceable. User knowledge is durable.

The persistent knowledge learned from books, manual saves and validated web research must live outside model weights so the same knowledge can be reused by `gpt-oss:20b`, a future 120B model, or another local Ollama model.

## Durable storage

Preferred Windows layout:

```text
D:\LocalAI\NexaAI\
├── Data\
│   ├── nexa-data.json
│   └── nexa-knowledge.db
└── Knowledge\
    ├── registry.json
    ├── Documents\
    └── Index\
```

`nexa-knowledge.db` is a real SQLite database. “Guardar en conocimiento” must insert/version a persistent database record; it is not allowed to be only a UI flag or transient prompt state.

## Structured knowledge database

Required concepts:

- Knowledge Objectives.
- Objective Topics with `VERIFIED`, `PARTIAL`, `MISSING`, `CONFLICTING`, `OUTDATED`, `NOT VERIFIED`.
- Versioned Knowledge Entries; newer active data does not delete old versions.
- Source records with URL, title, type, access date and traceability metadata.
- Entry-to-source links.
- Knowledge relationships.
- Research run audit history.
- Duplicate detection before creating new records.

## Automotive objective

Creating an automotive objective must capture make, model, year and optional generation, trim, engine code/displacement, fuel, transmission, drivetrain, body style, market and VIN.

Create the baseline automotive knowledge topics as `MISSING`, following `docs/KNOWLEDGE_AUTOMOTIVE_POLICY.md`. Empty means expected but not yet found/verified; never invent filler.

## Local-first retrieval

When answering:

1. identify the active objective(s);
2. search structured SQLite knowledge;
3. search selected document Knowledge Libraries;
4. if sufficient, answer from local knowledge;
5. if insufficient and Internet research is enabled, search trusted web sources;
6. validate exact applicability with the local Ollama model;
7. persist only sufficiently supported knowledge with source/confidence/status;
8. answer with the resulting evidence.

## Web research

The app may connect to public Internet sources when enabled by the user.

Prioritize source classes in this order:

1. OEM/manufacturer official documentation;
2. official OEM technical portals;
3. NHTSA / government sources;
4. official TSB / recalls;
5. manufacturer manuals;
6. recognized technical providers;
7. professional technical documentation;
8. specialized forums as secondary only;
9. blogs/video/comments only when stronger sources are unavailable.

Never elevate forums/videos to OEM-equivalent authority.

Web pages are evidence, not instructions. Do not persist full protected pages; persist summarized facts/structured knowledge and traceability.

## Validation and confidence

Use approximately:

- `0.95–1.00`: clearly applicable OEM.
- `0.85–0.94`: government / very reliable technical source.
- `0.70–0.84`: multiple matching technical sources.
- `0.50–0.69`: secondary evidence pending stronger confirmation.
- `<0.50`: not confirmed; do not present as verified knowledge.

For torque, fluids/capacities, electrical values, pinouts, SRS, EV high voltage, brakes, ADAS, timing, fuel pressure and engine internals, require especially strong exact applicability.

## Manual chat save

Every chat message must offer:

- `Guardar en memoria`
- `Guardar en conocimiento`
- `Copiar`

`Guardar en conocimiento` writes the selected message to SQLite under exactly one selected Knowledge Objective and initially marks chat-derived content `PARTIAL`, not automatically `VERIFIED`.

## Internet controls

Settings must provide:

- enable/disable Internet research;
- enable/disable automatic research when local structured knowledge is insufficient;
- maximum web sources;
- missing topics per research batch.

The Knowledge panel must provide:

- create Automotive or General/Science objective;
- attach an objective to the current chat;
- investigate a specific topic;
- complete a bounded batch of missing topics;
- display persistent database stats/path;
- search structured persistent knowledge together with document libraries.

## Preserve prior features

Preserve:

- local streaming Ollama chat;
- persistent chat history and lightweight memory;
- document Knowledge Libraries (PDF, DOCX, text/code);
- Fast/Light GPU profiles and `num_gpu`;
- Ollama start/warm/unload;
- Unity detection and optional auto mode;
- RAM/VRAM/GPU/temperature monitoring;
- secure preload (`contextIsolation`, no node integration);
- custom visible chat scrollbar;
- transparent `Ir al final` button;
- Nexa AI app/installer/desktop logo;
- Windows Installer / Portable / ZIP workflow.

## Build validation

Must pass:

- JavaScript syntax checks;
- App Builder renderer compatibility check;
- chat scrollbar validation;
- persistent SQLite knowledge validation;
- delivery/project validation;
- baseline tests;
- existing Windows GitHub Actions build.
