# Nexa AI v2.5.1 — Developer Runtime Stabilization

Focused Windows runtime stabilization over v2.5.0.

- Fixes `.cmd`/`.bat` execution on Windows without enabling an unrestricted shell.
- Reports which allowlisted commands are actually installed/available in PATH.
- Keeps generic Terminal allowlisted. Git is executed only through the dedicated controlled `developer.git.run` operations.
- Fixes the v2.5.0 contradiction where Git was enabled but internally blocked by the Terminal allowlist.
- Missing tools such as PHP now produce a clear `not installed / PATH` diagnostic.
- Preserves `main-v203.js`, Hosted Web architecture, Ollama/Qwen/Forge, Browser Agent, file tools, indexes and persistent jobs.
## App Builder compatibility fix

This corrected package replaces one JavaScript regular-expression literal in `lib/developer-runtime-v251.js` with parser-safe character checks. The original JavaScript was valid in Node, but Nexa App Builder Pro's conservative delimiter scanner reported `Unexpected closing delimiter ]`.

Validation on this corrected package:
- `node --check` PASS on every changed/new JavaScript file.
- Nexa App Builder delimiter/regex compatibility scan PASS on every changed/new JavaScript file.
- `validate-v251` PASS.
- `test-v251-developer-runtime` PASS.

