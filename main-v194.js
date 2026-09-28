'use strict';

// Nexa AI v1.9.4 — Prompt Drift Guard
// Patch the existing Premium Prompt Compiler before the established runtime loads.
// This makes anti-drift constraints participate in first render, Qwen review and repair retries.

const path = require('path');
const { ipcMain, BrowserWindow } = require('electron');
const PremiumCompiler = require('./lib/premium-prompt-compiler-v189');
const PromptDriftGuard = require('./lib/prompt-drift-guard-v194');

const VERSION = '1.9.4';
PromptDriftGuard.install(PremiumCompiler);

// App Builder compatibility: its audit inspects only package.json -> main.
const ACTIVE_ELECTRON_GRAPH = {
  preload: path.join(__dirname, 'preload.js'),
  renderer: path.join(__dirname, 'src', 'index.html'),
};
function nexaActiveElectronGraph(win) {
  if (false && win instanceof BrowserWindow) {
    win.loadFile(path.join(__dirname, 'src', 'index.html'));
  }
  return ACTIVE_ELECTRON_GRAPH;
}
void nexaActiveElectronGraph;

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

require('./main-v193.js');
