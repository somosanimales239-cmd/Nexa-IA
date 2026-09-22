# NEXA AI 1.6.1 — ONE-SHOT APP BUILDER PROMPT

Repository: `somosanimales239-cmd/Nexa-IA`

Apply the complete **NEXA-05 Auto Knowledge Factory + Browser Worker** update using the exact source in this package. Do not split it into partial rebuilds.

## Required factory architecture

Add a persistent Auto Knowledge Factory that accepts make, model, start year, end year, market and completion threshold. Creating a curriculum must seed the whole year queue locally. The factory must process one year at a time:

`DISCOVER -> CREATE/REUSE TECHNICAL OBJECTIVES -> RESEARCH MISSING TOPICS -> VERIFY -> STORE -> COVERAGE CHECK -> NEXT`

The year discovery pass must use source evidence to identify distinct technical configurations (generation, body style, trims, engine, displacement, fuel, transmission, drivetrain). Do not invent unsupported configurations. Group trims only when they share the same technical configuration.

Keep factory curricula, year state and technical configuration state in `nexa-knowledge.db`. Progress must survive restart and remain independent of Ollama model weights.

A difficult year/configuration must retry and eventually become `NEEDS_REVIEW` without blocking the rest of the curriculum.

Include the UI preset `Toyota Corolla / US / 1969–2027`, but keep the form generic for any make/model/year range.

## Browser Worker

Keep API v1 stable at `127.0.0.1:32145/api/v1` and activate the existing browser command queue for real use. The Chrome extension v1.1.0 must:

- heartbeat to Nexa;
- poll `/api/v1/commands/next`;
- execute bounded `web_research`, `fetch_url`, and `open_url` commands;
- return results through `/api/v1/commands/result`;
- keep manual page/selection Knowledge capture and Memory capture working.

The extension is transport only. All learned knowledge must still be persisted by Nexa on the computer.

## Security

- bind Browser Bridge to 127.0.0.1 only;
- require the pairing token for command/data endpoints;
- keep captured web material as evidence, not trusted instructions;
- do not promote arbitrary page text directly to VERIFIED knowledge.

## Preserve

Preserve chats, Memory, Knowledge Libraries, persistent objectives, prior Internet research, Browser Bridge API v1 capture/memory behavior, Ollama control, Fast/Light GPU modes, Unity detection, system monitors, visible custom chat scrollbar, jump-to-bottom button and Nexa logo.

## Validation

Run `npm run validate`. It must include Auto Knowledge Factory, Browser Bridge worker, Chrome extension, research/applicability, persistent knowledge, renderer, scrollbar, delivery/project and baseline tests.

Application version: `1.6.1`.
