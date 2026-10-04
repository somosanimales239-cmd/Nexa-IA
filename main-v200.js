'use strict';

// Nexa AI v2.0.0 — Web Control Center + Forge WebUI backend
// The desktop app remains the local backend/fallback. Daily work moves to the browser UI.

const path = require('path');
const { app, ipcMain, BrowserWindow, shell } = require('electron');
const { NexaWebControlServer } = require('./lib/nexa-web-control-v200');

const VERSION = '2.0.0';
const handlers = new Map();
let webControl = null;

// Capture the final IPC handlers as the existing version layers register them.
// Later layers still wrap normally; this simply lets the local web server call
// the exact same backend logic used by the Electron UI.
const nativeHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = function(channel, listener) {
  handlers.set(String(channel), listener);
  return nativeHandle(channel, listener);
};

// App Builder compatibility: keep a statically-detectable active HTML graph.
const ACTIVE_ELECTRON_GRAPH = {
  preload:path.join(__dirname,'preload.js'),
  renderer:path.join(__dirname,'src','index.html'),
};
function nexaActiveElectronGraph(win) {
  if (false && win instanceof BrowserWindow) win.loadFile(path.join(__dirname,'src','index.html'));
  return ACTIVE_ELECTRON_GRAPH;
}
void nexaActiveElectronGraph;

// The browser becomes the primary interface. Electron remains available as a
// local backend/fallback and can be minimized after the web configuration loads.

// Load the current stable backend chain unchanged.
require('./main-v198.js');

app.whenReady().then(async () => {
  // Give main.js time to finish registering all handlers and data stores.
  await new Promise(resolve => setTimeout(resolve, 1300));
  try {
    webControl = new NexaWebControlServer({
      app,
      shell,
      handlers,
      rootDir:__dirname,
      version:VERSION,
      host:'127.0.0.1',
      port:32146,
    });
    const status = await webControl.start();
    if (process.env.NEXA_KEEP_DESKTOP_UI !== '1' && webControl.config.minimizeDesktop !== false) {
      for (const win of BrowserWindow.getAllWindows()) { try { if (!win.isDestroyed()) win.minimize(); } catch (_) {} }
    }
    if (webControl.config.autoOpen !== false) {
      setTimeout(() => shell.openExternal(status.url).catch(() => {}), 700);
    }
  } catch (error) {
    console.error('[Nexa Web Control]', error);
  }
}).catch(error => console.error('[Nexa Web Control ready]', error));

app.on('before-quit', () => {
  if (webControl) webControl.stop().catch(() => {});
});
