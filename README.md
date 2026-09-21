# Nexa AI v1.2.3

Nexa AI is a Windows desktop control center for a **local Ollama** installation. Version 1.1 keeps chats, user memory and imported knowledge **outside the model weights**, so the same data can be reused later by another local model such as a future 120B model.

The current tested default remains `gpt-oss:20b` on Windows 10 with 32 GB RAM and an NVIDIA GTX 1070 Ti 8 GB.

## What version 1.1 includes

Everything from 1.0 plus a complete first Knowledge Library layer:

- Local streaming chat through `http://127.0.0.1:11434`.
- Persistent chat history with rename, search and delete.
- Persistent local memory independent from model weights.
- **Fast mode**: lets Ollama automatically choose GPU offload.
- **Light mode**: sends configurable `num_gpu` so Unity can keep more VRAM.
- Optional automatic Fast/Light switching when Unity is detected.
- RAM, AI RAM, Unity RAM, VRAM, GPU utilization and temperature monitoring.
- Start Ollama, warm/load model and unload model controls.
- **Knowledge Libraries** stored separately from both the application and the model.
- Manual creation of named knowledge collections such as `Toyota Corolla 2021`, `Physics`, `Unity Documentation`, etc.
- Import individual files or entire folders.
- Supported knowledge formats include PDF, DOCX, TXT, Markdown, JSON, CSV, logs and common source-code/configuration formats.
- Imported originals are copied into Nexa's local Knowledge folder by default so the knowledge does not disappear if the source file moves.
- Documents are extracted, chunked and indexed locally.
- PDF extraction keeps page numbers when available.
- Local search/test panel lets the user verify that an imported book can actually be found before relying on it in chat.
- Retrieval is bounded: only the most relevant chunks are sent to the selected model for a question.
- Responses can display the local source document/page used.
- Knowledge sources are explicitly instructed to take precedence over model general knowledge when relevant.
- No cloud AI endpoint is used.

## Model-independent architecture

The model is replaceable. The user's accumulated information is not.

```text
D:\LocalAI\
├── Ollama\
├── Models\
│   ├── gpt-oss-20b
│   └── future-model-120b
└── NexaAI\
    ├── Data\
    │   └── nexa-data.json        # chats, settings, memories
    └── Knowledge\
        ├── registry.json         # library catalog
        ├── Documents\           # copied books/manuals/files
        └── Index\               # extracted chunks/search index
```

Changing `settings.model` from `gpt-oss:20b` to another Ollama model does **not** migrate or modify `Data` or `Knowledge`. The new model immediately has access to the same Nexa memory and Knowledge Libraries through retrieval.

## Knowledge is not fine-tuning

Version 1.1 deliberately does not rewrite model weights. A 2,000-page automotive service manual or a science textbook is kept as a local source of truth. Nexa searches the local index for a user's question and injects only the most relevant excerpts into the prompt.

This gives three benefits:

1. A book can be added or removed without retraining the model.
2. A future model can reuse the same knowledge immediately.
3. Nexa can show which local document/page supported an answer.

## Important performance behavior

Fast mode omits `num_gpu`, preserving Ollama's automatic behavior. On the tested machine this previously loaded approximately 6 GB of VRAM for `gpt-oss:20b`.

Light mode defaults to `num_gpu = 6`. The live System panel is used to calibrate the exact layer count later. Changing modes unloads the currently loaded model; the next prompt/load reloads the **same** model with the new distribution. The model is never duplicated.

## Local data preservation

- Chats/settings/memories: `D:\LocalAI\NexaAI\Data` when `D:\LocalAI` exists.
- Knowledge Libraries: `D:\LocalAI\NexaAI\Knowledge` when `D:\LocalAI` exists.
- The installer is configured with `deleteAppDataOnUninstall: false`.
- Model files remain owned by Ollama in the configured model directory.

## Build

The repository follows the Nexa App Builder Pro Electron delivery contract. The build workflow can generate a dependency lock when `package-lock.json` is not present.

```powershell
npm install
npm run validate
npm run ui:smoke
npm run build:win
```

Windows delivery targets:

- NSIS installer
- Portable EXE
- Windows ZIP

The included `.github/workflows/nexa-windows-build.yml` remains the Nexa App Builder Pro Windows workflow.
