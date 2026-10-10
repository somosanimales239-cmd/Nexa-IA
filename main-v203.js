'use strict';

// Nexa AI — Hosted Web Agent wrapper. Existing Chat/Image handlers remain intact.
const path = require('path');
const { ipcMain, BrowserWindow, app } = require('electron');
const { HostedWebAgent } = require('./lib/hosted-web-agent-v203');
const HostedWebFastChat = require('./lib/hosted-web-fastchat-v204');

// Dedicated, strictly opt-in autonomous Developer runner v2.8.1.
// It ONLY intercepts developer.agent.*; all other traffic is delegated unchanged.
try {
  require('./lib/developer-autonomous-v281').install(HostedWebAgent);
} catch (error) {
  // Never break Nexa's existing working Chat, Image Studio or Hosted Web Agent.
  console.error('[Nexa Developer isolated agent unavailable]', error?.message || error);
}

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
  hostedAgent = new HostedWebAgent({ handlers: capturedHandlers, version: '2.8.1' });
  setTimeout(() => hostedAgent.start().catch(() => {}), 1200);
}).catch(() => {});

app.on('before-quit', () => {
  try { hostedAgent?.stop(); } catch (_) {}
});
