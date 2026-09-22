Nexa AI Browser Bridge v1.1.0

1. Open chrome://extensions
2. Enable Developer mode.
3. Choose Load unpacked and select this folder.
4. Open Nexa AI > Settings > Browser Extension Bridge.
5. Copy the Pairing token.
6. Open the extension Options page, paste the token, keep Browser Worker enabled, and click Save and verify.

Manual capture:
- Save selected text to Knowledge.
- Save the readable page to Knowledge.
- Save selected text to lightweight Memory.

Automatic Browser Worker:
- Heartbeats to Nexa AI over API v1.
- Polls Nexa's local browser command queue.
- Handles web_research commands for Auto Knowledge Factory.
- Returns source URLs and readable page text to Nexa, where verification/storage happens locally.

The extension is NOT the knowledge database. Learned knowledge remains in Nexa's local SQLite database on the computer.
