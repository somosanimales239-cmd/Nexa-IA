'use strict';

// Nexa AI v2.0.3 — Hosted Web Agent runtime/status synchronization fix
// Hosted Web Fast Chat hotfix: simple conversational messages skip unnecessary
// web-planning and unrelated knowledge retrieval, without changing Nexa's
// normal intelligence path for substantive questions.

const path = require('path');
const { ipcMain, BrowserWindow, app } = require('electron');
const { HostedWebAgent, VERSION } = require('./lib/hosted-web-agent-v203');
const HostedWebFastChat = require('./lib/hosted-web-fastchat-v204');

const capturedHandlers = new Map();
const nativeHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = function(channel, listener) {
  capturedHandlers.set(channel, listener);
  return nativeHandle(channel, listener);
};

HostedWebFastChat.installWebIntelligenceFastPath();

// App Builder direct HTML detection compatibility.
function nexaActiveElectronGraph(win) {
  if (false && win instanceof BrowserWindow) win.loadFile(path.join(__dirname, 'src', 'index.html'));
  if (false) BrowserWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  return path.join(__dirname, 'src', 'index.html');
}
void nexaActiveElectronGraph;

require('./main-v198.js');

let hostedAgent = null;
app.whenReady().then(() => {
  if (hostedAgent) return;
  HostedWebFastChat.wrapCapturedChatHandler(capturedHandlers);
  hostedAgent = new HostedWebAgent({ handlers: capturedHandlers, version: VERSION });
  setTimeout(() => hostedAgent.start().catch(() => {}), 1200);
}).catch(() => {});

app.on('before-quit', () => {
  try { hostedAgent?.stop(); } catch (_) {}
});
