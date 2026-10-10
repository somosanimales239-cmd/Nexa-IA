'use strict';

// Nexa AI v1.9.0 — Chat Attachments + Qwen Vision + Chat Reference Consistency
// Layered on the stable v1.8.9 -> v1.8.8 -> main.js runtime.

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { ipcMain, BrowserWindow, app } = require('electron');
const Routing = require('./lib/chat-routing-v190');

const VERSION = '1.9.0';
const OLLAMA_URL = 'http://127.0.0.1:11434';
const VISION_MODEL = 'qwen2.5vl:3b';
const STAGE_TTL_MS = 30 * 60 * 1000;
const MAX_FILES = 8;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 45 * 1024 * 1024;
const staged = new Map();

const ACTIVE_ELECTRON_GRAPH = {
  preload: path.join(__dirname, 'preload.js'),
  renderer: path.join(__dirname, 'src', 'index.html'),
};
function nexaActiveGraphHint(win) {
  if (false && win instanceof BrowserWindow) win.loadFile(path.join(__dirname, 'src', 'index.html'));
  return ACTIVE_ELECTRON_GRAPH;
}
void nexaActiveGraphHint;

function requestJson(method, urlString, body, timeoutMs = 0) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const options = {
      method,
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      headers: payload ? { 'Content-Type':'application/json', 'Content-Length':payload.length } : {},
    };
    if (timeoutMs > 0) options.timeout = timeoutMs;
    const req = http.request(options, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0,1000)}`));
        if (!raw.trim()) return resolve({});
        try { resolve(JSON.parse(raw)); }
        catch (error) { reject(new Error('Respuesta JSON inválida de Ollama: ' + error.message)); }
      });
    });
    if (timeoutMs > 0) req.on('timeout', () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function dataRoot() {
  const preferred = process.platform === 'win32' ? 'D:\\LocalAI\\NexaAI\\Data' : '';
  if (preferred) {
    try { fs.mkdirSync(preferred, { recursive:true }); return preferred; } catch (_) {}
  }
  const fallback = path.join(app.getPath('userData'), 'Data');
  fs.mkdirSync(fallback, { recursive:true });
  return fallback;
}

function safeName(value) {
  return String(value || 'attachment').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-120) || 'attachment';
}

function typeOfFile(name, mime) {
  const ext = path.extname(String(name || '')).toLowerCase();
  const mt = String(mime || '').toLowerCase();
  if (mt.startsWith('image/') || ['.png','.jpg','.jpeg','.webp'].includes(ext)) return 'image';
  if (ext === '.pdf' || mt === 'application/pdf') return 'pdf';
  if (ext === '.docx' || mt.includes('wordprocessingml')) return 'docx';
  if (['.txt','.md','.csv','.json'].includes(ext) || mt.startsWith('text/')) return 'text';
  return 'other';
}

async function extractPdf(buffer) {
  try {
    const modulePath = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    const pdfjs = await import(pathToFileURL(modulePath).href);
    const task = pdfjs.getDocument({ data:new Uint8Array(buffer), disableWorker:true });
    const pdf = await task.promise;
    const chunks = [];
    const pageLimit = Math.min(pdf.numPages, 80);
    let totalChars = 0;
    for (let i=1; i<=pageLimit; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const line = content.items.map(item => item.str || '').join(' ');
      chunks.push(line);
      totalChars += line.length;
      if (totalChars > 30000) break;
    }
    return chunks.join('\n').slice(0,30000);
  } catch (error) {
    return `[PDF adjunto; no se pudo extraer texto: ${error.message}]`;
  }
}

async function extractDocx(buffer) {
  try {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return String(result.value || '').slice(0,30000);
  } catch (error) {
    return `[DOCX adjunto; no se pudo extraer texto: ${error.message}]`;
  }
}

async function extractDocument(kind, buffer) {
  if (kind === 'text') return buffer.toString('utf8').slice(0,30000);
  if (kind === 'pdf') return extractPdf(buffer);
  if (kind === 'docx') return extractDocx(buffer);
  return '';
}

function makeToken() { return crypto.randomBytes(8).toString('hex'); }
function markerRegex() { return /\u2063\u2063([\u200B\u200C]+)\u2064\u2064/g; }
function decodeMarkerBits(bits) {
  let out = '';
  for (let i=0; i+7<bits.length; i+=8) {
    let n = 0;
    for (let j=0; j<8; j++) n = (n << 1) | (bits[i+j] === '\u200C' ? 1 : 0);
    out += String.fromCharCode(n);
  }
  return out;
}
function findToken(value) {
  const match = markerRegex().exec(String(value || ''));
  return match ? decodeMarkerBits(match[1]) : '';
}
function stripMarkers(value) { return String(value || '').replace(markerRegex(), ''); }

function cleanupStages() {
  const now = Date.now();
  for (const [token, record] of staged) if (now - record.createdAt > STAGE_TTL_MS) staged.delete(token);
}
setInterval(cleanupStages, 5 * 60 * 1000).unref?.();

function publicAttachment(file) {
  return {
    name:String(file.name || ''),
    kind:String(file.kind || ''),
    mime:String(file.mime || ''),
    size:Number(file.size || 0),
    path:String(file.path || ''),
  };
}

function attachmentSource(file) {
  const meta = publicAttachment(file);
  return {
    libraryId:'',
    libraryName:'',
    documentId:'',
    documentName:meta.name,
    page:null,
    chunk:null,
    path:meta.path,
    url:'',
    sourceType:'chat_attachment',
    objectiveId:'',
    entryId:'',
    citation:JSON.stringify({ kind:meta.kind, mime:meta.mime, size:meta.size }),
    verificationStatus:'local_attachment',
    confidence:1,
    vehicle:'',
  };
}

function mergeAttachmentSources(message, record) {
  if (!record) return message;
  const existing = Array.isArray(message?.sources) ? message.sources.filter(x => x?.sourceType !== 'chat_attachment') : [];
  return { ...message, sources:[...existing, ...record.files.map(attachmentSource)] };
}

function releaseHeavyData(token) {
  const record = staged.get(token);
  if (!record) return;
  record.processedAt = Date.now();
  for (const file of record.files) {
    file.data = '';
    file.extractedText = '';
  }
}

const nativeHandle = ipcMain.handle.bind(ipcMain);

nativeHandle('chat-attachments:stage', async (_event, payload={}) => {
  cleanupStages();
  const incoming = Array.isArray(payload.files) ? payload.files.slice(0,MAX_FILES) : [];
  let total = 0;
  const files = [];
  const dir = path.join(dataRoot(), 'ChatAttachments');
  fs.mkdirSync(dir, { recursive:true });

  for (const item of incoming) {
    const data = String(item?.data || '');
    if (!data) continue;
    const buffer = Buffer.from(data, 'base64');
    if (!buffer.length) continue;
    if (buffer.length > MAX_FILE_BYTES) throw new Error(`El archivo ${item?.name || ''} supera 15 MB.`);
    total += buffer.length;
    if (total > MAX_TOTAL_BYTES) throw new Error('Los adjuntos superan el límite total de 45 MB.');
    const kind = typeOfFile(item?.name, item?.type);
    if (kind === 'other') throw new Error(`Tipo de archivo no soportado: ${item?.name || 'archivo'}`);
    const diskName = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${safeName(item?.name)}`;
    const full = path.join(dir, diskName);
    fs.writeFileSync(full, buffer);
    files.push({
      name:String(item?.name || diskName),
      mime:String(item?.type || ''),
      kind,
      size:buffer.length,
      path:full,
      data:kind === 'image' ? data : '',
      extractedText:kind === 'image' ? '' : await extractDocument(kind, buffer),
    });
  }

  if (!files.length) throw new Error('No se recibió ningún adjunto válido.');
  const token = makeToken();
  staged.set(token, { token, createdAt:Date.now(), files });
  return { ok:true, token, files:files.map(publicAttachment) };
});

async function qwenVision(event, payload, record) {
  const images = record.files.filter(file => file.kind === 'image' && file.data).slice(0,4);
  const docs = record.files.filter(file => file.kind !== 'image' && file.extractedText);
  const lastUser = [...(payload.messages || [])].reverse().find(message => message.role === 'user');
  const userText = stripMarkers(lastUser?.content || '').trim() || 'Describe las imágenes adjuntas.';
  const docContext = docs.map(doc => `\n--- DOCUMENTO: ${doc.name} ---\n${doc.extractedText}`).join('').slice(0,18000);
  const prompt = [
    'You are Nexa Vision, the local visual understanding engine.',
    'Answer naturally in the same language used by the user.',
    'Use only visible image evidence and attached document text.',
    'If something cannot be determined, say so instead of inventing it.',
    'Be practical and direct.',
    '',
    'USER REQUEST:',
    userText,
    docContext ? `\nATTACHED DOCUMENT CONTEXT:${docContext}` : '',
  ].filter(Boolean).join('\n');

  const response = await requestJson('POST', OLLAMA_URL + '/api/chat', {
    model:VISION_MODEL,
    stream:false,
    keep_alive:'0s',
    options:{ temperature:0.15, num_ctx:4096, num_predict:1000, num_gpu:0, repeat_penalty:1.12 },
    messages:[{ role:'user', content:prompt, images:images.map(image => image.data) }],
  }, 0);

  const answer = String(response?.message?.content || '').trim() || 'No pude obtener una descripción visual.';
  const requestId = String(payload.requestId || '');
  if (event?.sender && !event.sender.isDestroyed()) {
    event.sender.send('chat:token', { requestId, content:answer });
    event.sender.send('chat:done', { requestId, stats:{ visionModel:VISION_MODEL } });
  }
  return { ok:true, vision:true, model:VISION_MODEL };
}

function augmentDocumentPayload(payload, record) {
  const docs = record.files.filter(file => file.kind !== 'image' && file.extractedText);
  if (!docs.length) return payload;
  const cloned = { ...payload, messages:(payload.messages || []).map(message => ({ ...message })) };
  let lastUserIndex = -1;
  for (let i=cloned.messages.length-1; i>=0; i--) if (cloned.messages[i].role === 'user') { lastUserIndex = i; break; }
  if (lastUserIndex < 0) return cloned;
  const cleanText = stripMarkers(cloned.messages[lastUserIndex].content || '');
  const context = docs.map(doc => `\n\n[DOCUMENTO ADJUNTO: ${doc.name}]\n${doc.extractedText}`).join('').slice(0,20000);
  cloned.messages[lastUserIndex].content = cleanText + context;
  return cloned;
}

function referenceConfigFromRecord(userText, record, existingConfig) {
  const images = record?.files?.filter(file => file.kind === 'image' && file.data).slice(0,4) || [];
  if (!images.length || !Routing.wantsReference(userText)) return existingConfig || null;
  const mode = Routing.referenceMode(userText);
  return {
    enabled:true,
    mode,
    strength:78,
    identityWeight:mode === 'style' ? 55 : 92,
    styleWeight:72,
    compositionWeight:42,
    useInRetries:true,
    anchorOnRetry:true,
    source:'chat',
    images:images.map(file => ({ name:file.name, type:file.mime || 'image/jpeg', data:file.data })),
  };
}

ipcMain.handle = function(channel, listener) {
  if (channel === 'chat:start') {
    return nativeHandle(channel, async (event, payload={}) => {
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const lastUser = [...messages].reverse().find(message => message.role === 'user');
      const token = findToken(lastUser?.content || '');
      const record = token ? staged.get(token) : null;
      if (!record) return listener(event, payload);
      try {
        const hasImages = record.files.some(file => file.kind === 'image' && file.data);
        if (hasImages) return await qwenVision(event, payload, record);
        return await listener(event, augmentDocumentPayload(payload, record));
      } finally {
        releaseHeavyData(token);
      }
    });
  }

  if (channel === 'image:generate') {
    return nativeHandle(channel, async (event, payload={}) => {
      const token = findToken(payload.userRequest || '');
      const record = token ? staged.get(token) : null;
      if (!record) return listener(event, payload);
      const cleanRequest = stripMarkers(payload.userRequest || '').trim();
      const outgoing = {
        ...payload,
        userRequest:cleanRequest,
        referenceConfig:referenceConfigFromRecord(cleanRequest, record, payload.referenceConfig),
      };
      try {
        return await listener(event, outgoing);
      } finally {
        releaseHeavyData(token);
      }
    });
  }

  if (channel === 'store:chat:save') {
    return nativeHandle(channel, async (event, chat) => {
      if (!chat || typeof chat !== 'object') return listener(event, chat);
      const clean = {
        ...chat,
        messages:Array.isArray(chat.messages) ? chat.messages.map(message => {
          const token = findToken(message?.content || '');
          const record = token ? staged.get(token) : null;
          const base = { ...message, content:stripMarkers(message?.content || '') };
          return record ? mergeAttachmentSources(base, record) : base;
        }) : chat.messages,
      };
      return listener(event, clean);
    });
  }

  if (channel === 'store:get') {
    return nativeHandle(channel, async (...args) => {
      const snapshot = await listener(...args);
      if (snapshot && typeof snapshot === 'object') snapshot.appVersion = VERSION;
      return snapshot;
    });
  }

  return nativeHandle(channel, listener);
};

function injectChatAttachments(win) {
  try {
    if (!win?.webContents) return;
    const file = path.join(__dirname, 'src', 'chat-attachments-v190.js');
    const source = fs.readFileSync(file, 'utf8');
    const apply = () => win.webContents.executeJavaScript(source).catch(() => {});
    win.webContents.on('did-finish-load', () => setTimeout(apply, 900));
    if (!win.webContents.isLoading()) setTimeout(apply, 900);
  } catch (_) {}
}
app.on('browser-window-created', (_event, win) => injectChatAttachments(win));
app.whenReady().then(() => { for (const win of BrowserWindow.getAllWindows()) injectChatAttachments(win); }).catch(() => {});

require('./main-v189.js');
