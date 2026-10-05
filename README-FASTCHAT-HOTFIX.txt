Nexa AI v2.0.3 — Hosted Web FAST CHAT HOTFIX

Confirmed by the job diagnostics:
- Successful greeting: claimed 12:54:07, first token 12:56:56 (~169 seconds).
- Before answering, Nexa injected an unrelated 2021 Toyota Camry Knowledge DB source.
- Another simple chat was claimed 12:59:50 and did not produce text; around 13:03:07 it only produced unrelated 2025 Toyota RAV4 Knowledge context, then was cancelled.
- The successful Ollama packet reported ~47 seconds total generation. Most of the extreme delay was before answer streaming.

This hotfix changes only Hosted Web casual chat:
- greetings/courtesy skip Premium Web Intelligence planning;
- greetings/courtesy are isolated from unrelated global Knowledge DB/library retrieval;
- current, technical, factual, research and explicit web requests keep the full Nexa pipeline;
- desktop Nexa chat is untouched.

Functional files:
- main-v203.js
- lib/hosted-web-fastchat-v204.js

This ZIP does NOT include lib/hosted-web-agent-v203.js.
Keep the Worker Watchdog hotfix already installed.
