'use strict';

// Nexa AI v2.0.0 — Hosted Web Agent for public_html

const path = require('path');
const { ipcMain, BrowserWindow, app } = require('electron');
const { HostedWebAgent, VERSION } = require('./lib/hosted-web-agent-v200');

const capturedHandlers = new Map();
const nativeHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = function(channel, listener) {
  capturedHandlers.set(channel, listener);
  return nativeHandle(channel, listener);
};

// App Builder direct HTML detection compatibility.
function nexaActiveElectronGraph(win) {
  if (false && win instanceof BrowserWindow) win.loadFile(path.join(__dirname, 'src', 'index.html'));
  return path.join(__dirname, 'src', 'index.html');
}
void nexaActiveElectronGraph;

require('./main-v198.js');

let hostedAgent = null;
app.whenReady().then(() => {
  if (hostedAgent) return;
  hostedAgent = new HostedWebAgent({ handlers: capturedHandlers, version: VERSION });
  setTimeout(() => hostedAgent.start().catch(() => {}), 1200);
}).catch(() => {});

app.on('before-quit', () => {
  try { hostedAgent?.stop(); } catch (_) {}
});
