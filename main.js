'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn, execFile } = require('child_process');
const crypto = require('crypto');

const APP_VERSION = '1.0.0';
const DEFAULTS = Object.freeze({
  model: 'gpt-oss:20b',
  baseUrl: 'http://127.0.0.1:11434',
  ollamaExe: 'D:\\LocalAI\\Ollama\\ollama.exe',
  modelsPath: 'D:\\LocalAI\\Models',
  profile: 'fast',
  lightGpuLayers: 6,
  contextLength: 4096,
  keepAlive: '5m',
  autoUnityMode: false,
  includeMemories: true,
});

let mainWindow = null;
let store = null;
let ollamaChild = null;
const activeRequests = new Map();

function id(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

function safeClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function dataDirectory() {
  if (process.env.NEXA_UI_SMOKE === '1') return app.getPath('userData');
  if (process.platform === 'win32') {
    const preferred = 'D:\\LocalAI\\NexaAI\\Data';
    try {
      if (fs.existsSync('D:\\LocalAI')) {
        fs.mkdirSync(preferred, { recursive: true });
        return preferred;
      }
    } catch (_) {}
  }
  const fallback = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

class JsonStore {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'nexa-data.json');
    this.backup = path.join(dir, 'nexa-data.backup.json');
    fs.mkdirSync(dir, { recursive: true });
    this.state = this.load();
  }

  emptyState() {
    return {
      schemaVersion: 1,
      settings: { ...DEFAULTS },
      chats: [],
      memories: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  load() {
    for (const candidate of [this.file, this.backup]) {
      try {
        if (!fs.existsSync(candidate)) continue;
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        return {
          ...this.emptyState(),
          ...parsed,
          settings: { ...DEFAULTS, ...(parsed.settings || {}) },
          chats: Array.isArray(parsed.chats) ? parsed.chats : [],
          memories: Array.isArray(parsed.memories) ? parsed.memories : [],
        };
      } catch (_) {}
    }
    return this.emptyState();
  }

  save() {
    this.state.updatedAt = new Date().toISOString();
    const temp = `${this.file}.tmp`;
    const payload = `${JSON.stringify(this.state, null, 2)}\n`;
    try {
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.backup);
    } catch (_) {}
    fs.writeFileSync(temp, payload, 'utf8');
    fs.renameSync(temp, this.file);
  }

  snapshot() {
    return safeClone({ ...this.state, dataDirectory: this.dir, appVersion: APP_VERSION });
  }

  saveSettings(patch) {
    const allowed = [
      'model', 'baseUrl', 'ollamaExe', 'modelsPath', 'profile', 'lightGpuLayers',
      'contextLength', 'keepAlive', 'autoUnityMode', 'includeMemories',
    ];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch || {}, key)) this.state.settings[key] = patch[key];
    }
    if (!['fast', 'light'].includes(this.state.settings.profile)) this.state.settings.profile = 'fast';
    this.state.settings.lightGpuLayers = Math.max(0, Math.min(99, Number(this.state.settings.lightGpuLayers) || 0));
    this.state.settings.contextLength = Math.max(1024, Math.min(32768, Number(this.state.settings.contextLength) || 4096));
    this.save();
    return safeClone(this.state.settings);
  }

  upsertChat(chat) {
    const now = new Date().toISOString();
    const clean = {
      id: String(chat.id || id('chat')),
      title: String(chat.title || 'Nuevo chat').slice(0, 120),
      createdAt: chat.createdAt || now,
      updatedAt: now,
      messages: Array.isArray(chat.messages) ? chat.messages.map(m => ({
        id: String(m.id || id('msg')),
        role: ['user', 'assistant', 'system'].includes(m.role) ? m.role : 'user',
        content: String(m.content || ''),
        createdAt: m.createdAt || now,
      })) : [],
    };
    const index = this.state.chats.findIndex(item => item.id === clean.id);
    if (index >= 0) this.state.chats[index] = clean;
    else this.state.chats.unshift(clean);
    this.state.chats.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    this.save();
    return safeClone(clean);
  }

  deleteChat(chatId) {
    this.state.chats = this.state.chats.filter(chat => chat.id !== chatId);
    this.save();
    return true;
  }

  addMemory(memory) {
    const now = new Date().toISOString();
    const item = {
      id: String(memory.id || id('mem')),
      text: String(memory.text || '').trim().slice(0, 6000),
      enabled: memory.enabled !== false,
      createdAt: memory.createdAt || now,
      updatedAt: now,
    };
    if (!item.text) throw new Error('La memoria no puede estar vacía.');
    const index = this.state.memories.findIndex(x => x.id === item.id);
    if (index >= 0) this.state.memories[index] = item;
    else this.state.memories.unshift(item);
    this.save();
    return safeClone(item);
  }

  deleteMemory(memoryId) {
    this.state.memories = this.state.memories.filter(memory => memory.id !== memoryId);
    this.save();
    return true;
  }
}

function requestJson(method, urlString, body, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port || 80,
      path: `${url.pathname}${url.search}`,
      timeout: timeoutMs,
      headers: payload ? {
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
      } : {},
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Ollama HTTP ${res.statusCode}: ${text.slice(0, 800)}`));
          return;
        }
        if (!text.trim()) return resolve({});
        try { resolve(JSON.parse(text)); }
        catch (error) { reject(new Error(`Respuesta JSON inválida de Ollama: ${error.message}`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado.')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function ollamaStatus() {
  const settings = store.state.settings;
  try {
    const [tags, ps] = await Promise.all([
      requestJson('GET', `${settings.baseUrl}/api/tags`, undefined, 1800),
      requestJson('GET', `${settings.baseUrl}/api/ps`, undefined, 1800).catch(() => ({ models: [] })),
    ]);
    const installed = Array.isArray(tags.models) ? tags.models.map(m => m.name || m.model) : [];
    const running = Array.isArray(ps.models) ? ps.models : [];
    const selected = running.find(m => (m.name || m.model) === settings.model) || null;
    return {
      online: true,
      installed,
      modelInstalled: installed.includes(settings.model),
      running: running.map(m => ({
        name: m.name || m.model,
        size: Number(m.size || 0),
        sizeVram: Number(m.size_vram || 0),
        expiresAt: m.expires_at || null,
      })),
      selectedRunning: selected ? {
        name: selected.name || selected.model,
        size: Number(selected.size || 0),
        sizeVram: Number(selected.size_vram || 0),
        expiresAt: selected.expires_at || null,
      } : null,
    };
  } catch (error) {
    return { online: false, installed: [], modelInstalled: false, running: [], selectedRunning: null, error: error.message };
  }
}

function startOllama() {
  return new Promise(async resolve => {
    const current = await ollamaStatus();
    if (current.online) return resolve({ ok: true, alreadyRunning: true, status: current });
    const settings = store.state.settings;
    if (!fs.existsSync(settings.ollamaExe)) {
      return resolve({ ok: false, error: `No se encontró Ollama en ${settings.ollamaExe}` });
    }
    try {
      ollamaChild = spawn(settings.ollamaExe, ['serve'], {
        windowsHide: true,
        detached: false,
        stdio: 'ignore',
        env: { ...process.env, OLLAMA_MODELS: settings.modelsPath },
      });
      ollamaChild.on('exit', () => { ollamaChild = null; });
      const started = Date.now();
      const timer = setInterval(async () => {
        const status = await ollamaStatus();
        if (status.online || Date.now() - started > 15000) {
          clearInterval(timer);
          resolve(status.online ? { ok: true, alreadyRunning: false, status } : { ok: false, error: 'Ollama no respondió después de 15 segundos.' });
        }
      }, 500);
    } catch (error) {
      resolve({ ok: false, error: error.message });
    }
  });
}

async function unloadModel() {
  const settings = store.state.settings;
  return new Promise(resolve => {
    if (!fs.existsSync(settings.ollamaExe)) return resolve({ ok: false, error: 'No se encontró ollama.exe.' });
    execFile(settings.ollamaExe, ['stop', settings.model], {
      windowsHide: true,
      timeout: 10000,
      env: { ...process.env, OLLAMA_MODELS: settings.modelsPath },
    }, error => resolve(error ? { ok: false, error: error.message } : { ok: true }));
  });
}

async function warmModel() {
  const settings = store.state.settings;
  const status = await ollamaStatus();
  if (!status.online) {
    const start = await startOllama();
    if (!start.ok) return start;
  }
  const options = { num_ctx: Number(settings.contextLength) || 4096 };
  if (settings.profile === 'light') options.num_gpu = Number(settings.lightGpuLayers) || 0;
  try {
    await requestJson('POST', `${settings.baseUrl}/api/generate`, {
      model: settings.model,
      prompt: '',
      stream: false,
      keep_alive: settings.keepAlive,
      options,
    }, 300000);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function memoriesSystemPrompt() {
  const settings = store.state.settings;
  if (!settings.includeMemories) return null;
  const enabled = store.state.memories.filter(memory => memory.enabled && memory.text.trim()).slice(0, 40);
  if (!enabled.length) return null;
  return [
    'Memoria local de Nexa AI. Usa estos datos solo cuando sean relevantes para la petición actual.',
    ...enabled.map((memory, index) => `${index + 1}. ${memory.text.trim()}`),
  ].join('\n');
}

function streamChat(event, payload) {
  const requestId = String(payload.requestId || id('req'));
  const settings = store.state.settings;
  const url = new URL(`${settings.baseUrl}/api/chat`);
  const memories = memoriesSystemPrompt();
  const sourceMessages = Array.isArray(payload.messages) ? payload.messages : [];
  const clipped = sourceMessages.slice(-36).map(message => ({ role: message.role, content: String(message.content || '') }));
  const messages = memories ? [{ role: 'system', content: memories }, ...clipped] : clipped;
  const options = { num_ctx: Number(settings.contextLength) || 4096 };
  if (settings.profile === 'light') options.num_gpu = Number(settings.lightGpuLayers) || 0;

  const body = Buffer.from(JSON.stringify({
    model: settings.model,
    messages,
    stream: true,
    keep_alive: settings.keepAlive,
    options,
  }));

  const req = http.request({
    method: 'POST', hostname: url.hostname, port: url.port || 80, path: url.pathname,
    headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
  }, res => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      let errorText = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { errorText += chunk; });
      res.on('end', () => {
        activeRequests.delete(requestId);
        event.sender.send('chat:error', { requestId, error: `Ollama HTTP ${res.statusCode}: ${errorText.slice(0, 600)}` });
      });
      return;
    }
    let buffer = '';
    let sawDone = false;
    const handlePacket = packet => {
      if (packet.message?.content) event.sender.send('chat:token', { requestId, content: packet.message.content });
      if (packet.done && !sawDone) {
        sawDone = true;
        event.sender.send('chat:done', { requestId, stats: {
          totalDuration: packet.total_duration || 0,
          loadDuration: packet.load_duration || 0,
          promptEvalCount: packet.prompt_eval_count || 0,
          evalCount: packet.eval_count || 0,
          evalDuration: packet.eval_duration || 0,
        }});
      }
    };
    res.setEncoding('utf8');
    res.on('data', chunk => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try { handlePacket(JSON.parse(line)); } catch (_) {}
      }
    });
    res.on('end', () => {
      if (buffer.trim()) {
        try { handlePacket(JSON.parse(buffer)); } catch (_) {}
      }
      const wasActive = activeRequests.has(requestId);
      activeRequests.delete(requestId);
      if (wasActive && !sawDone) event.sender.send('chat:done', { requestId, stats: {} });
    });
  });
  req.on('error', error => {
    const wasActive = activeRequests.has(requestId);
    activeRequests.delete(requestId);
    if (wasActive) event.sender.send('chat:error', { requestId, error: error.message });
  });
  req.write(body);
  req.end();
  activeRequests.set(requestId, req);
  return { ok: true, requestId };
}

function execFileText(file, args, timeout = 2500) {
  return new Promise(resolve => {
    execFile(file, args, { windowsHide: true, timeout }, (error, stdout) => resolve(error ? '' : String(stdout || '')));
  });
}

async function getProcessRamGb(names) {
  if (process.platform !== 'win32') return 0;
  const nameFilter = names.map(name => `'${name.replace(/'/g, "''")}'`).join(',');
  const command = `$n=@(${nameFilter}); $p=Get-Process -ErrorAction SilentlyContinue | Where-Object { $n -contains $_.ProcessName }; [math]::Round((($p | Measure-Object WorkingSet64 -Sum).Sum/1GB),2)`;
  const text = await execFileText('powershell.exe', ['-NoProfile', '-Command', command]);
  const value = Number(String(text).trim().replace(',', '.'));
  return Number.isFinite(value) ? value : 0;
}

async function getGpuStats() {
  if (process.platform !== 'win32') return { available: false };
  const text = await execFileText('nvidia-smi.exe', ['--query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu', '--format=csv,noheader,nounits']);
  if (!text.trim()) return { available: false };
  const [first] = text.trim().split(/\r?\n/);
  const parts = first.split(',').map(value => value.trim());
  return {
    available: true,
    name: parts[0] || 'NVIDIA GPU',
    memoryUsedMb: Number(parts[1]) || 0,
    memoryTotalMb: Number(parts[2]) || 0,
    utilization: Number(parts[3]) || 0,
    temperature: Number(parts[4]) || 0,
  };
}

async function systemStats() {
  const [status, gpu, unityRam, aiRam] = await Promise.all([
    ollamaStatus(), getGpuStats(), getProcessRamGb(['Unity']), getProcessRamGb(['llama-server']),
  ]);
  const totalRamGb = os.totalmem() / 1024 / 1024 / 1024;
  const freeRamGb = os.freemem() / 1024 / 1024 / 1024;
  const selected = status.selectedRunning;
  const aiVramMb = selected ? selected.sizeVram / 1024 / 1024 : 0;
  const modelSizeMb = selected ? selected.size / 1024 / 1024 : 0;
  return {
    at: new Date().toISOString(),
    ollama: status,
    ram: {
      totalGb: Number(totalRamGb.toFixed(2)),
      usedGb: Number((totalRamGb - freeRamGb).toFixed(2)),
      freeGb: Number(freeRamGb.toFixed(2)),
      unityGb: unityRam,
      aiGb: aiRam,
    },
    gpu: {
      ...gpu,
      aiVramMb: Number(aiVramMb.toFixed(0)),
      otherVramMb: gpu.available ? Math.max(0, Number(gpu.memoryUsedMb || 0) - aiVramMb) : 0,
      aiGpuPercentOfModel: modelSizeMb > 0 ? Number(((aiVramMb / modelSizeMb) * 100).toFixed(0)) : 0,
    },
    unityDetected: unityRam > 0,
    profile: store.state.settings.profile,
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#070b14',
    title: 'Nexa AI',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function registerIpc() {
  ipcMain.handle('store:get', () => store.snapshot());
  ipcMain.handle('store:settings', (_event, patch) => store.saveSettings(patch || {}));
  ipcMain.handle('store:chat:save', (_event, chat) => store.upsertChat(chat || {}));
  ipcMain.handle('store:chat:delete', (_event, chatId) => store.deleteChat(String(chatId)));
  ipcMain.handle('store:memory:save', (_event, memory) => store.addMemory(memory || {}));
  ipcMain.handle('store:memory:delete', (_event, memoryId) => store.deleteMemory(String(memoryId)));
  ipcMain.handle('engine:status', () => ollamaStatus());
  ipcMain.handle('engine:start', () => startOllama());
  ipcMain.handle('engine:unload', () => unloadModel());
  ipcMain.handle('engine:warm', () => warmModel());
  ipcMain.handle('system:stats', () => systemStats());
  ipcMain.handle('system:open-data', () => shell.openPath(store.dir));
  ipcMain.handle('chat:start', (event, payload) => streamChat(event, payload || {}));
  ipcMain.handle('chat:stop', (_event, requestId) => {
    const req = activeRequests.get(String(requestId));
    if (!req) return false;
    activeRequests.delete(String(requestId));
    req.destroy(new Error('Generación detenida por el usuario.'));
    return true;
  });
}

app.whenReady().then(() => {
  store = new JsonStore(dataDirectory());
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  for (const req of activeRequests.values()) {
    try { req.destroy(); } catch (_) {}
  }
  activeRequests.clear();
});
