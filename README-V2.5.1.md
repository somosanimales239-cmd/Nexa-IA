# Nexa AI v2.5.1 — COMPLETE ONE UPDATE

Single consolidated update over Nexa AI v2.5.0.

Includes all v2.5.1 changes and the fixes discovered during App Builder/GitHub validation:

- Windows `.cmd` / `.bat` controlled execution stabilization.
- Runtime command availability reporting.
- Dedicated controlled Git runner; Git no longer passes through the generic Terminal allowlist.
- Clear missing-tool diagnostics (for example PHP not installed / not in PATH).
- App Builder conservative delimiter-scanner compatibility fix in `developer-runtime-v251.js`.
- Forward-compatible v2.5.0 historical validator so newer compatible runtimes do not fail because the old validator expects exactly v2.5.0.
- Forward-compatible v2.5.1 validator for the same historical-validation model.
- Preserves `main-v203.js`, the `main-v203 -> main-v198` chain, Hosted Web Agent architecture, Ollama/Qwen/Forge, Browser Agent, file tools, code index, database tools and persistent jobs.

## App Builder import

This archive intentionally has one neutral top-level folder: `NexaUpdate/`.
Nexa App Builder Pro should strip that wrapper and target paths such as:

- `package.json`
- `lib/developer-runtime-v251.js`
- `lib/hosted-web-agent-v203.js`
- `scripts/validate-v250.js`
- `scripts/validate-v251.js`

Do not apply if those files appear flattened into the repository root without their `lib/` or `scripts/` directories.
