# NEXA-02 — Model-Independent Knowledge Layer

Update **Nexa AI from 1.0.0 to 1.2.4** as one complete update. Preserve every working 1.0 feature and add a durable Knowledge Library system that lives outside model weights.

## Core rule

The selected LLM is replaceable. Chats, memories and imported knowledge are durable user assets.

A future change from `gpt-oss:20b` to a 120B model must not require rebuilding, retraining or copying the user's memory/knowledge. The new model must be able to use the same local Nexa stores immediately.

## Existing 1.0 capabilities that must remain

1. Local streaming chat.
2. Durable conversations.
3. Durable manual memory.
4. Fast GPU profile.
5. Light configurable `num_gpu` profile.
6. Model unload/reload when changing performance profile.
7. Ollama start/warm/unload controls.
8. RAM/VRAM/GPU/temperature monitor.
9. Unity detection plus optional automatic mode switching.
10. Editable Ollama/model paths and context settings.
11. Offline-first operation with no cloud AI API dependency.
12. Installer, Portable and ZIP output through the existing Windows workflow.

## New 1.1 Knowledge capabilities

1. Separate persistent root `D:\LocalAI\NexaAI\Knowledge` when available, with fallback to Electron userData.
2. `registry.json` plus backup for named library metadata.
3. `Documents` directory for copied source material.
4. `Index` directory for extracted chunks.
5. Create/delete/enable named Knowledge Libraries.
6. Import multiple files or a recursively scanned folder.
7. Default to copying imported originals into the Knowledge root so knowledge survives source moves.
8. Parse PDF page by page with page metadata.
9. Parse DOCX as raw text.
10. Parse text, Markdown, JSON, CSV, logs, code and common configuration files.
11. Hash imported files to avoid duplicate ingestion of the same file into a library.
12. Chunk extracted text with overlap and persist the chunks outside the model.
13. Local lexical relevance search with a UI test/search panel.
14. Per-library and per-chat enable/selection controls.
15. Before chat generation, search the enabled Knowledge Libraries using the newest user request.
16. Inject only bounded relevant chunks into the system context.
17. Source-grounding instruction: user-provided Knowledge should take precedence over general model knowledge when relevant; do not invent unsupported source facts.
18. Preserve source metadata and show source chips under assistant responses.
19. Settings for Knowledge enable/disable, max chunks and max injected characters.
20. An action to open the Knowledge folder directly.

## Storage independence

The app must keep three concerns separate:

- Model weights: Ollama model folder.
- Chats/settings/memories: Nexa `Data` folder.
- Books/manuals/index: Nexa `Knowledge` folder.

No model install/update/unload operation may delete or rewrite Data or Knowledge.

## Non-goals for 1.1

- Fine-tuning or LoRA training.
- Cloud vector databases.
- Cloud embeddings.
- Internet search/browsing.
- Remote Windows/Unity control.

Those can be layered on later without replacing the local Knowledge store.
