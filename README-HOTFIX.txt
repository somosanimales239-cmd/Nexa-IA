Nexa AI v2.0.3 — Hosted Web Heartbeat HOTFIX

Exact problem fixed:
v2.0.3 waited for Forge/Ollama runtime probes BEFORE sending the PC heartbeat.
When Forge is not installed/offline, that probe can take long enough for the web page
to mark the PC as offline.

Fix:
- heartbeat is sent immediately first
- Forge/Ollama runtime probe runs in background
- only one runtime probe can run at a time
- no public_html files need to be changed

Replace:
  lib/hosted-web-agent-v203.js

Then rebuild/install Nexa AI v2.0.3 and open it.
