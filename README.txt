Nexa AI v1.7.0 Build 99 chat completion update

This source package is designed for Nexa App Builder Pro Manual Delivery.
It updates the real project source paths used by the Windows build.

Changes in this delivery:
- main.js: normal chat uses think=false with GPT-OSS, reserves a larger effective context window, limits history passed with each request, and allows a long visible response.
- src/app.js: source metadata remains attached internally, but the Fuentes usadas block is no longer rendered in the chat.
- README.txt: safe replacement for the earlier hotfix README so the current App Builder validator does not misread decorative separator lines as a merge conflict.

This package intentionally contains source files only. It does not contain app.asar, installers, node_modules, release files, credentials, or generated build artifacts.
