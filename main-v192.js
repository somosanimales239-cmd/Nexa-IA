'use strict';

// Nexa AI v1.9.2
// - Web Intelligence keeps internal source IDs private.
// - Conflicting/partial current research gets a focused official-source second pass.
// - Conversation names can be edited directly from the sidebar.

const fs = require('fs');
const path = require('path');
const { ipcMain, BrowserWindow, app } = require('electron');
const WebIntel = require('./lib/web-intelligence-v191');
const Refine = require('./lib/web-intelligence-refinements-v192');

const VERSION = '1.9.2';
Refine.install(WebIntel);

const ACTIVE_ELECTRON_GRAPH = { preload:path.join(__dirname,'preload.js'), renderer:path.join(__dirname,'src','index.html') };
function nexaActiveGraphHint(win) { if (false && win instanceof BrowserWindow) win.loadFile(path.join(__dirname,'src','index.html')); return ACTIVE_ELECTRON_GRAPH; }
void nexaActiveGraphHint;

const nativeHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = function(channel, listener) {
  if (channel === 'store:get') {
    return nativeHandle(channel, async (...args) => {
      const snapshot = await listener(...args);
      if (snapshot && typeof snapshot === 'object') snapshot.appVersion = VERSION;
      return snapshot;
    });
  }
  return nativeHandle(channel, listener);
};

function injectConversationTools(win) {
  try {
    if (!win?.webContents) return;
    const file = path.join(__dirname, 'src', 'conversation-tools-v192.js');
    const source = fs.readFileSync(file, 'utf8');
    const apply = () => win.webContents.executeJavaScript(source).catch(() => {});
    win.webContents.on('did-finish-load', () => setTimeout(apply, 1300));
    if (!win.webContents.isLoading()) setTimeout(apply, 1300);
  } catch (_) {}
}
app.on('browser-window-created', (_event, win) => injectConversationTools(win));
app.whenReady().then(() => {
  for (const win of BrowserWindow.getAllWindows()) injectConversationTools(win);
}).catch(() => {});

require('./main-v191.js');
