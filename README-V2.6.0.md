# Nexa AI v2.6.0 — Dedicated Developer Coder Brain

This update keeps normal Nexa Chat on its existing brain and gives Nexa Developer a dedicated local coding model through Ollama.

Developer model default:
- qwen2.5-coder:7b
- Ollama: http://127.0.0.1:11434
- context: 16384
- temperature: 0.1
- keep_alive: 15m

New Developer commands:
- developer.ai.status
- developer.ai.generate

The model can be changed later through developer.config without changing normal Chat.
