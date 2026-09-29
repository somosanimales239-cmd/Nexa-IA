'use strict';

// Nexa AI v1.9.7 — Comfy Model Inspector + Smart Checkpoint Router + High-Resolution 4K Pipeline

const fs = require('fs');
const path = require('path');
const { ipcMain, BrowserWindow, app } = require('electron');
const Intelligence = require('./lib/image-intelligence-v197');
const PremiumCompiler = require('./lib/premium-prompt-compiler-v189');
const Routing = require('./lib/chat-routing-v190');

const VERSION = '1.9.7';
let runtimeSettings = { comfyBaseUrl:'http://127.0.0.1:8188' };

Intelligence.installCompiler(PremiumCompiler);
Intelligence.installRouting(Routing);

const ACTIVE_ELECTRON_GRAPH = {
  preload:path.join(__dirname,'preload.js'),
  renderer:path.join(__dirname,'src','index.html'),
};
function nexaActiveElectronGraph(win) {
  if (false && win instanceof BrowserWindow) win.loadFile(path.join(__dirname,'src','index.html'));
  return ACTIVE_ELECTRON_GRAPH;
}
void nexaActiveElectronGraph;

function progress(event, requestId, phase, label, extra={}) {
  try { if(event?.sender && !event.sender.isDestroyed()) event.sender.send('image:progress',{requestId:String(requestId||''),phase,label,...extra}); } catch(_) {}
}

const nativeHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = function(channel, listener) {
  if (channel === 'store:get') {
    return nativeHandle(channel, async (...args) => {
      const snapshot = await listener(...args);
      if (snapshot && typeof snapshot === 'object') {
        runtimeSettings = { ...runtimeSettings, ...(snapshot.settings || {}) };
        snapshot.appVersion = VERSION;
        try {
          snapshot.comfyModelInspector = await Intelligence.inspectComfyRuntime(runtimeSettings);
        } catch (_) {}
      }
      return snapshot;
    });
  }
  if (channel === 'store:settings') {
    return nativeHandle(channel, async (event, patch) => {
      const saved = await listener(event, patch);
      runtimeSettings = { ...runtimeSettings, ...(saved || patch || {}) };
      return saved;
    });
  }
  if (channel === 'image:generate') {
    return nativeHandle(channel, async (event, payload={}) => {
      const requestId = String(payload.requestId || '');
      progress(event,requestId,'image-intelligence','Nexa Image Intelligence: analizando intención, checkpoint y pipeline de alta resolución…');
      const prepared = await Intelligence.prepareRuntimePlan(payload.userRequest || '', runtimeSettings, label=>progress(event,requestId,'checkpoint-routing',label));
      progress(event,requestId,'image-intelligence','Nexa Image Intelligence: request limpio listo para generación y post-proceso high-res.',{style:prepared.style,purpose:prepared.purpose,requirements:prepared.requirements.length,checkpoint:prepared.runtime?.resolvedCheckpoint||'',highResolutionPlan:prepared.highResolutionPlan||null});
      const outgoing = {
        ...payload,
        userRequest:prepared.generationRequest,
        _nexaOriginalUserRequest:prepared.originalRequest,
        _nexaImagePlan:prepared,
        comfyCheckpoint:prepared.runtime?.resolvedCheckpoint || payload.comfyCheckpoint || runtimeSettings.comfyCheckpoint || '',
        checkpointRouting:prepared.runtime || null,
      };
      const result = await listener(event,outgoing);
      progress(event,requestId,'output-validation','Nexa Output: comprobando resolución exacta, transparencia y pipeline high-res…');
      return Intelligence.finalizeOutput(result,prepared,runtimeSettings,label=>progress(event,requestId,'output-postprocess',label));
    });
  }
  return nativeHandle(channel, listener);
};

function injectRenderer(win) {
  try {
    if(!win?.webContents)return;
    const source=fs.readFileSync(path.join(__dirname,'src','image-intelligence-v197.js'),'utf8');
    const apply=()=>win.webContents.executeJavaScript(source).catch(()=>{});
    win.webContents.on('did-finish-load',()=>setTimeout(apply,650));
    if(!win.webContents.isLoading())setTimeout(apply,650);
  } catch(_) {}
}
app.on('browser-window-created',(_event,win)=>injectRenderer(win));
app.whenReady().then(()=>{for(const win of BrowserWindow.getAllWindows())injectRenderer(win);}).catch(()=>{});

require('./main-v195.js');

try {
  const Visual = require('./lib/visual-review-v188');
  Intelligence.installVisualReview(Visual);
} catch(_) {}
