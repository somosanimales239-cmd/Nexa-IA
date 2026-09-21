## 1.2.5
- Fixed GitHub Actions build failure caused by a stale package-lock.json left from older versions.
- The Windows workflow now detects version/dependency mismatches in package-lock.json and regenerates it automatically from package.json before npm ci.
- This specifically recovers missing Knowledge dependencies such as mammoth and pdfjs-dist without requiring manual repository cleanup.
- Preserves the Nexa AI logo, chat scrollbar, floating Ir al final button, Knowledge Libraries, memory and performance profiles.

## 1.2.5
- Fixed App Builder parsing failure in `src/app.js` by removing JavaScript regular-expression literals from renderer code while preserving identical behavior.
- Kept the conversation scrollbar and translucent `↓ Ir al final` button.
- Kept the new Nexa AI logo bundled for the application window, installer, Start Menu and desktop shortcut.
- Added an explicit validation guard so future packages fail if regex literals are accidentally reintroduced into `src/app.js`.

## 1.2.5
- Fixed the conversation viewport with a dedicated visible chat scrollbar.
- Added a semi-transparent floating “Ir al final” button that appears when the user scrolls away from the newest messages.
- Preserved manual scroll position while the assistant streams new text; automatic follow resumes only when the user is near the bottom or taps the button.
- Bundled the new Nexa AI logo for in-app branding, Windows installer, application executable and desktop shortcut.

## 1.2.0
- Added a visible scrollable conversation experience with a dedicated semi-transparent "Ir al final" floating button.
- Added premium Nexa AI desktop branding and bundled application icon assets for the app window, installer and desktop shortcut.
- Improved in-app brand presentation in the sidebar and welcome screen using the new Nexa AI logo.

# Changelog

## 1.1.0

- Added model-independent Knowledge Libraries stored outside Ollama model weights.
- Added separate local `Knowledge/registry.json`, `Documents/` and `Index/` stores.
- Added PDF page extraction through pdfjs-dist.
- Added DOCX text extraction through mammoth.
- Added text/code/config file and recursive folder ingestion.
- Added SHA-256 duplicate detection for imported files.
- Added local chunking/indexing and bounded retrieval for chat prompts.
- Added source-grounding prompt and source chips under responses.
- Added per-library activation and per-chat library selection.
- Added manual local Knowledge search panel.
- Added Knowledge injection settings.
- Preserved Fast/Light modes, Unity monitoring, chats, memories and offline operation.
- Raised application version to 1.1.0.

## 1.0.0

- Initial local Ollama control center.
