'use strict';

// Nexa AI v1.9.8 — Completion-Safe Comfy Recovery + Adaptive High-Resolution 4K Pipeline

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { ipcMain, BrowserWindow, app } = require('electron');
const Intelligence = require('./lib/image-intelligence-v198');
const PremiumCompiler = require('./lib/premium-prompt-compiler-v189');
const Routing = require('./lib/chat-routing-v190');

const VERSION = '1.9.8';
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

function transport(url) { return url.protocol === 'https:' ? https : http; }
function requestJson(method, urlString, body, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = transport(url).request({
      method,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + (url.search || ''),
      headers: payload ? { 'Content-Type':'application/json', 'Content-Length':payload.length } : undefined,
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => text += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0,400)}`));
        try { resolve(text.trim() ? JSON.parse(text) : {}); } catch (error) { reject(error); }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function requestBuffer(method, urlString, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const req = transport(url).request({ method, hostname:url.hostname, port:url.port || (url.protocol==='https:'?443:80), path:url.pathname + (url.search||'') }, res => {
      const chunks=[];
      res.on('data', c=>chunks.push(c));
      res.on('end', ()=>{
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}`));
        resolve(Buffer.concat(chunks));
      });
    });
    req.setTimeout(timeoutMs,()=>req.destroy(new Error('Timeout')));
    req.on('error',reject);
    req.end();
  });
}
function collectImages(entry) {
  const out = [];
  for (const node of Object.values(entry?.outputs || {})) {
    if (Array.isArray(node?.images)) out.push(...node.images);
  }
  return out;
}
function readSize(filePath) {
  try {
    const img = require('electron').nativeImage?.createFromPath(filePath);
    const s = img?.getSize?.();
    if (s?.width && s?.height) return s;
  } catch (_) {}
  return { width:0, height:0 };
}
function timeoutLikeError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return /tardó demasiado|timed out|timeout|etimedout|socket hang up|abort/i.test(msg);
}
function tokenize(text) {
  const stop = new Set(['para','with','this','that','from','after','before','imagen','image','crear','creame','generame','genera','create','make','draw','render','prompt','negative','prompt','exacta','resolucion','resolution','final','quality','calidad']);
  const seen = new Set();
  const out = [];
  for (const token of String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!token || token.length < 4 || stop.has(token) || seen.has(token)) continue;
    seen.add(token); out.push(token);
    if (out.length >= 12) break;
  }
  return out;
}
function scoreHistoryEntry(entry, prepared) {
  const images = collectImages(entry);
  if (!images.length) return -1;
  const haystack = JSON.stringify(entry || {}).toLowerCase();
  const tokens = tokenize(prepared?.originalRequest || prepared?.positive || '');
  let score = 0;
  for (const token of tokens) if (haystack.includes(token)) score += 2;
  if (prepared?.style === 'photorealistic' && /realvis|photoreal|realistic|juggernaut|zavy|epicrealism/.test(haystack)) score += 4;
  if (prepared?.style === 'anime' && /anime|manga|animagine|toon|cartoon/.test(haystack)) score += 4;
  if (prepared?.technical?.wants4k && /3840|2160|2048|1536|upscale/.test(haystack)) score += 1;
  return score;
}
async function recoverTimedOutGeneration(error, requestId, prepared, settings = {}, progressCb) {
  if (!timeoutLikeError(error)) return null;
  const baseUrl = String(settings.comfyBaseUrl || 'http://127.0.0.1:8188').replace(/\/$/, '');
  progressCb?.('ComfyUI tardó más de lo esperado. Intentando recuperar la salida reciente desde el historial para no perder el trabajo…');
  const history = await requestJson('GET', baseUrl + '/history', null, 30000).catch(() => null);
  if (!history || typeof history !== 'object') return null;

  const recent = Object.entries(history).slice(-12).reverse().map(([promptId, entry]) => ({ promptId, entry, score: scoreHistoryEntry(entry, prepared), images: collectImages(entry) })).filter(item => item.images.length);
  if (!recent.length) return null;
  recent.sort((a, b) => b.score - a.score);
  const chosen = recent[0];
  const imageMeta = chosen.images[0];
  if (!imageMeta?.filename) return null;

  const q = new URLSearchParams({ filename:String(imageMeta.filename||''), subfolder:String(imageMeta.subfolder||''), type:String(imageMeta.type||'output') });
  const buffer = await requestBuffer('GET', baseUrl + '/view?' + q.toString(), 300000).catch(() => null);
  if (!buffer || !buffer.length) return null;

  const tempDir = app.getPath('temp');
  const filePath = path.join(tempDir, `nexa-v198-recovered-${requestId || Date.now()}.png`);
  fs.writeFileSync(filePath, buffer);
  const size = readSize(filePath);
  progressCb?.(`Comfy History Rescue: imagen recuperada ${size.width || '?'}×${size.height || '?'} desde ${chosen.promptId}. Se continúa con validación y salida final.`);
  return {
    requestId,
    image: {
      path: filePath,
      fileName: path.basename(filePath),
      width: size.width || 0,
      height: size.height || 0,
    },
    summary: 'Imagen recuperada desde ComfyUI después de un timeout de espera.',
    recovery: {
      version: VERSION,
      mode: 'comfy-history-rescue',
      sourcePromptId: chosen.promptId,
      score: chosen.score,
    },
  };
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
      let result;
      try {
        result = await listener(event,outgoing);
      } catch (error) {
        const recovered = await recoverTimedOutGeneration(error, requestId, prepared, runtimeSettings, label=>progress(event,requestId,'timeout-recovery',label));
        if (!recovered) throw error;
        result = recovered;
      }
      progress(event,requestId,'output-validation','Nexa Output: comprobando resolución exacta, transparencia y pipeline high-res…');
      return Intelligence.finalizeOutput(result,prepared,runtimeSettings,label=>progress(event,requestId,'output-postprocess',label));
    });
  }
  return nativeHandle(channel, listener);
};

function injectRenderer(win) {
  try {
    if(!win?.webContents)return;
    const source=fs.readFileSync(path.join(__dirname,'src','image-intelligence-v198.js'),'utf8');
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
