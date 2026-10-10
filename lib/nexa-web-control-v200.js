'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = '2.0.0';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 32146;
const MAX_JSON_BODY = 70 * 1024 * 1024;

function nowIso() { return new Date().toISOString(); }
function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function asText(value, max = 20000) { return String(value ?? '').trim().slice(0, max); }
function safeJson(value, fallback = null) { try { return JSON.parse(value); } catch (_) { return fallback; } }
function uid(prefix = 'id') { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`; }
function atomicWrite(file, data) {
  const tmp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(body);
}
function sendText(res, status, body, contentType='text/plain; charset=utf-8') {
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(body);
}
function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}
function isLoopback(address) {
  const clean = String(address || '').replace(/^::ffff:/, '');
  return clean === '127.0.0.1' || clean === '::1' || clean === '';
}
function encodeAttachmentToken(token) {
  let bits = '';
  for (const ch of String(token || '')) {
    const code = ch.charCodeAt(0) & 0xff;
    for (let i=7; i>=0; i--) bits += ((code >> i) & 1) ? '\u200C' : '\u200B';
  }
  return token ? `\u2063\u2063${bits}\u2064\u2064` : '';
}
function attachTokenToMessages(messages, token) {
  const rows = Array.isArray(messages) ? messages.map(x => ({ ...x })) : [];
  const marker = encodeAttachmentToken(token);
  if (!marker) return rows;
  for (let i=rows.length-1; i>=0; i--) {
    if (rows[i]?.role === 'user') {
      rows[i].content = String(rows[i].content || '') + marker;
      break;
    }
  }
  return rows;
}
function splitPromptSections(raw, negativeInput='') {
  const text = String(raw || '').replace(/```(?:\w+)?/g, '').replace(/```/g, '').trim();
  if (negativeInput && String(negativeInput).trim()) return { positive:text, negative:String(negativeInput).trim() };
  const m = /\b(?:negative\s+prompt|prompt\s+negativo|negativo)\b\s*[:\-]?/i.exec(text);
  if (!m) return { positive:text, negative:'' };
  return { positive:text.slice(0,m.index).trim(), negative:text.slice(m.index + m[0].length).trim() };
}
function normalizeDimension(value, fallback) {
  let n = clamp(value, 256, 2048, fallback);
  n = Math.round(n / 8) * 8;
  return Math.max(256, n);
}
function chooseImagePlan(input = {}) {
  const preset = String(input.preset || 'landscape').toLowerCase();
  const fourK = input.fourK === true || preset.startsWith('4k-');
  let width = normalizeDimension(input.width, preset.includes('portrait') ? 768 : preset.includes('square') ? 1024 : 1024);
  let height = normalizeDimension(input.height, preset.includes('portrait') ? 1024 : preset.includes('square') ? 1024 : 576);
  let targetWidth = width, targetHeight = height;
  if (fourK) {
    if (preset.includes('portrait') || height > width) {
      width = 576; height = 1024; targetWidth = 2160; targetHeight = 3840;
    } else if (preset.includes('square')) {
      width = 1024; height = 1024; targetWidth = 3072; targetHeight = 3072;
    } else {
      width = 1024; height = 576; targetWidth = 3840; targetHeight = 2160;
    }
  }
  return {
    width, height, targetWidth, targetHeight, fourK,
    steps: Math.round(clamp(input.steps, 5, 80, 28)),
    cfg: clamp(input.cfg, 1, 15, 5.5),
    seed: Number.isFinite(Number(input.seed)) ? Number(input.seed) : -1,
    hiresFix: input.hiresFix !== false,
    hiresScale: clamp(input.hiresScale, 1, 2, 1.5),
    denoise: clamp(input.denoise, 0.05, 0.8, 0.32),
  };
}
function chooseUpscaler(list, requested='') {
  const names = (Array.isArray(list) ? list : []).map(x => typeof x === 'string' ? x : String(x?.name || '')).filter(Boolean);
  if (requested && names.includes(requested)) return requested;
  const preferred = [
    /4x.*ultrasharp/i,
    /r-esrgan.*4x/i,
    /realesrgan.*4x/i,
    /swinir.*4x/i,
    /esrgan.*4x/i,
    /lanczos/i,
  ];
  for (const re of preferred) {
    const found = names.find(name => re.test(name));
    if (found) return found;
  }
  return names.find(name => name.toLowerCase() !== 'none') || names[0] || 'None';
}
function chooseHiresUpscaler(latentModes, requested='') {
  const names = (Array.isArray(latentModes) ? latentModes : []).map(x => typeof x === 'string' ? x : String(x?.name || '')).filter(Boolean);
  if (requested && names.includes(requested)) return requested;
  return names.find(x => /latent.*bicubic.*antialiased/i.test(x))
    || names.find(x => /latent.*bicubic/i.test(x))
    || names.find(x => /latent/i.test(x))
    || '';
}
function stripDataUri(value) {
  const raw = String(value || '');
  const comma = raw.indexOf(',');
  return raw.startsWith('data:image/') && comma >= 0 ? raw.slice(comma + 1) : raw;
}
function requestJson(method, urlString, body, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const transport = url.protocol === 'https:' ? https : http;
    const options = {
      method,
      hostname:url.hostname,
      port:url.port || (url.protocol === 'https:' ? 443 : 80),
      path:url.pathname + url.search,
      headers:payload ? {'Content-Type':'application/json','Content-Length':payload.length} : {},
    };
    const req = transport.request(options, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0,1000)}`));
        if (!raw.trim()) return resolve({});
        try { resolve(JSON.parse(raw)); }
        catch (error) { reject(new Error(`JSON inválido desde ${url.hostname}: ${error.message}`)); }
      });
    });
    if (Number(timeoutMs) > 0) req.setTimeout(Number(timeoutMs), () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

class NexaWebControlServer {
  constructor({ app, shell, handlers, rootDir, host=DEFAULT_HOST, port=DEFAULT_PORT, version=VERSION } = {}) {
    if (!app || !handlers || !rootDir) throw new Error('NexaWebControlServer requires app, handlers and rootDir.');
    this.app = app;
    this.shell = shell || null;
    this.handlers = handlers;
    this.rootDir = rootDir;
    this.webDir = path.join(rootDir, 'webapp');
    this.host = host;
    this.port = Number.isInteger(Number(port)) ? Number(port) : DEFAULT_PORT;
    this.version = version;
    this.server = null;
    this.token = crypto.randomBytes(32).toString('base64url');
    this.startedAt = '';
    this.dataDir = this.resolveDataDir();
    this.generatedDir = path.join(this.dataDir, 'WebGenerated');
    this.configPath = path.join(this.dataDir, 'nexa-web-control.json');
    fs.mkdirSync(this.generatedDir, { recursive:true });
    this.config = this.loadConfig();
  }

  resolveDataDir() {
    if (process.platform === 'win32') {
      try {
        if (fs.existsSync('D:\\LocalAI')) {
          const preferred = 'D:\\LocalAI\\NexaAI\\Data';
          fs.mkdirSync(preferred, { recursive:true });
          return preferred;
        }
      } catch (_) {}
    }
    const fallback = path.join(this.app.getPath('userData'), 'data');
    fs.mkdirSync(fallback, { recursive:true });
    return fallback;
  }

  defaultConfig() {
    return {
      version:1,
      forgeBaseUrl:'http://127.0.0.1:7860',
      forgeModel:'',
      forgeSampler:'DPM++ 2M',
      forgeScheduler:'Karras',
      forgeUpscaler:'',
      forgeHiresUpscaler:'',
      steps:28,
      cfg:5.5,
      hiresFix:true,
      hiresScale:1.5,
      denoise:0.32,
      autoOpen:true,
      minimizeDesktop:true,
      updatedAt:nowIso(),
    };
  }

  loadConfig() {
    let parsed = null;
    try { parsed = JSON.parse(fs.readFileSync(this.configPath,'utf8')); } catch (_) {}
    const config = { ...this.defaultConfig(), ...(parsed || {}), updatedAt:nowIso() };
    this.saveConfig(config);
    return config;
  }

  saveConfig(patch = {}) {
    this.config = { ...(this.config || this.defaultConfig()), ...(patch || {}), updatedAt:nowIso() };
    atomicWrite(this.configPath, JSON.stringify(this.config, null, 2) + '\n');
    return { ...this.config };
  }

  status() {
    const address = this.server?.address?.();
    const port = address && typeof address === 'object' ? address.port : this.port;
    return {
      ok:Boolean(this.server?.listening), service:'Nexa Web Control', version:this.version,
      host:this.host, port, url:`http://${this.host}:${port}/`, startedAt:this.startedAt,
    };
  }

  async start() {
    if (this.server?.listening) return this.status();
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req,res) => this.handle(req,res));
      this.server.on('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.startedAt = nowIso();
        const a = this.server.address();
        if (a && typeof a === 'object') this.port = a.port;
        resolve(this.status());
      });
    });
  }

  async stop() {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise(resolve => server.close(() => resolve()));
  }

  async invoke(channel, args = [], sender = null) {
    const listener = this.handlers.get(channel);
    if (typeof listener !== 'function') throw new Error(`Nexa backend todavía no registró ${channel}.`);
    const event = { sender: sender || { isDestroyed:()=>false, send:()=>{} } };
    return await listener(event, ...(Array.isArray(args) ? args : []));
  }

  authorized(req) {
    return String(req.headers['x-nexa-web-token'] || '') === this.token;
  }

  async readJson(req) {
    return new Promise((resolve,reject) => {
      let total = 0;
      const chunks = [];
      req.on('data', chunk => {
        total += chunk.length;
        if (total > MAX_JSON_BODY) {
          reject(new Error('La solicitud es demasiado grande.'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (_) { reject(new Error('JSON inválido.')); }
      });
      req.on('error', reject);
    });
  }

  serveFile(res, fullPath) {
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return sendText(res,404,'Not found');
    res.statusCode = 200;
    res.setHeader('Content-Type', mimeFor(fullPath));
    res.setHeader('Cache-Control', path.extname(fullPath) === '.html' ? 'no-store' : 'no-cache');
    res.setHeader('X-Content-Type-Options','nosniff');
    fs.createReadStream(fullPath).pipe(res);
  }

  async forgeGet(route, timeout=7000) {
    const base = String(this.config.forgeBaseUrl || 'http://127.0.0.1:7860').replace(/\/$/,'');
    return requestJson('GET', base + route, null, timeout);
  }

  async forgePost(route, body, timeout=0) {
    const base = String(this.config.forgeBaseUrl || 'http://127.0.0.1:7860').replace(/\/$/,'');
    return requestJson('POST', base + route, body, timeout);
  }

  async forgeSnapshot() {
    const settled = await Promise.allSettled([
      this.forgeGet('/sdapi/v1/options'),
      this.forgeGet('/sdapi/v1/sd-models'),
      this.forgeGet('/sdapi/v1/samplers'),
      this.forgeGet('/sdapi/v1/schedulers'),
      this.forgeGet('/sdapi/v1/upscalers'),
      this.forgeGet('/sdapi/v1/latent-upscale-modes'),
    ]);
    if (settled[0].status === 'rejected' && settled[1].status === 'rejected') {
      return { ok:false, baseUrl:this.config.forgeBaseUrl, error:'Forge no respondió. Inícialo con API activada (--api).', models:[],samplers:[],schedulers:[],upscalers:[],latentModes:[] };
    }
    const value = i => settled[i].status === 'fulfilled' ? settled[i].value : [];
    return {
      ok:true,
      baseUrl:this.config.forgeBaseUrl,
      options:value(0) || {},
      models:Array.isArray(value(1)) ? value(1) : [],
      samplers:Array.isArray(value(2)) ? value(2) : [],
      schedulers:Array.isArray(value(3)) ? value(3) : [],
      upscalers:Array.isArray(value(4)) ? value(4) : [],
      latentModes:Array.isArray(value(5)) ? value(5) : [],
    };
  }

  async generateForge(body = {}) {
    const sections = splitPromptSections(body.prompt, body.negativePrompt);
    if (!sections.positive) throw new Error('Escribe una descripción para la imagen.');
    const snapshot = await this.forgeSnapshot();
    if (!snapshot.ok) throw new Error(snapshot.error || 'Forge no está disponible.');
    const plan = chooseImagePlan({
      ...body,
      steps:body.steps ?? this.config.steps,
      cfg:body.cfg ?? this.config.cfg,
      hiresFix:body.hiresFix ?? this.config.hiresFix,
      hiresScale:body.hiresScale ?? this.config.hiresScale,
      denoise:body.denoise ?? this.config.denoise,
    });
    const modelNames = (snapshot.models || []).flatMap(x => [String(x?.title || ''), String(x?.model_name || '')]).filter(Boolean);
    const requestedModel = asText(body.model || this.config.forgeModel, 500);
    const model = requestedModel && modelNames.includes(requestedModel) ? requestedModel : '';
    const samplerNames = (snapshot.samplers || []).map(x => String(x?.name || '')).filter(Boolean);
    const requestedSampler = asText(body.sampler || this.config.forgeSampler, 200);
    const sampler = samplerNames.includes(requestedSampler) ? requestedSampler : (samplerNames.find(x => /dpm\+\+ 2m$/i.test(x)) || samplerNames[0] || '');
    const schedulerNames = (snapshot.schedulers || []).map(x => String(x?.label || x?.name || '')).filter(Boolean);
    const requestedScheduler = asText(body.scheduler || this.config.forgeScheduler, 200);
    const scheduler = schedulerNames.includes(requestedScheduler) ? requestedScheduler : (schedulerNames.find(x => /karras/i.test(x)) || schedulerNames[0] || '');
    const upscaler = chooseUpscaler(snapshot.upscalers, body.upscaler || this.config.forgeUpscaler);
    const hiresUpscaler = chooseHiresUpscaler(snapshot.latentModes, body.hiresUpscaler || this.config.forgeHiresUpscaler);

    const payload = {
      prompt:sections.positive,
      negative_prompt:sections.negative,
      seed:plan.seed,
      steps:plan.steps,
      cfg_scale:plan.cfg,
      width:plan.width,
      height:plan.height,
      batch_size:1,
      n_iter:1,
      send_images:true,
      save_images:false,
    };
    if (sampler) payload.sampler_name = sampler;
    if (scheduler) payload.scheduler = scheduler;
    if (model) {
      payload.override_settings = { sd_model_checkpoint:model };
      payload.override_settings_restore_afterwards = false;
    }
    if (plan.hiresFix && hiresUpscaler) {
      payload.enable_hr = true;
      payload.hr_scale = plan.hiresScale;
      payload.hr_upscaler = hiresUpscaler;
      payload.denoising_strength = plan.denoise;
      payload.hr_second_pass_steps = Math.max(8, Math.round(plan.steps * 0.55));
    }

    const started = Date.now();
    const generated = await this.forgePost('/sdapi/v1/txt2img', payload, 45 * 60 * 1000);
    let image = stripDataUri(generated?.images?.[0] || '');
    if (!image) throw new Error('Forge respondió sin imagen.');
    let stage = 'txt2img';

    if (plan.targetWidth !== plan.width || plan.targetHeight !== plan.height) {
      const upscalePayload = {
        resize_mode:1,
        show_extras_results:true,
        gfpgan_visibility:0,
        codeformer_visibility:0,
        codeformer_weight:0,
        upscaling_resize:2,
        upscaling_resize_w:plan.targetWidth,
        upscaling_resize_h:plan.targetHeight,
        upscaling_crop:false,
        upscaler_1:upscaler,
        upscaler_2:'None',
        extras_upscaler_2_visibility:0,
        upscale_first:false,
        image,
      };
      const upscaled = await this.forgePost('/sdapi/v1/extra-single-image', upscalePayload, 45 * 60 * 1000);
      const candidate = stripDataUri(upscaled?.image || '');
      if (candidate) { image = candidate; stage = 'txt2img+upscale'; }
    }

    const fileName = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}.png`;
    const filePath = path.join(this.generatedDir, fileName);
    fs.writeFileSync(filePath, Buffer.from(image, 'base64'));
    const info = typeof generated?.info === 'string' ? safeJson(generated.info, generated.info) : generated?.info;
    return {
      ok:true,
      imageUrl:`/generated/${encodeURIComponent(fileName)}`,
      path:filePath,
      fileName,
      width:plan.targetWidth,
      height:plan.targetHeight,
      stage,
      elapsedSeconds:Math.round((Date.now()-started)/1000),
      model:model || snapshot.options?.sd_model_checkpoint || '',
      sampler,
      scheduler,
      upscaler,
      hiresUpscaler,
      prompt:sections.positive,
      negativePrompt:sections.negative,
      info,
    };
  }

  async bootstrap() {
    const [snapshot, knowledge, objectives, knowledgeStats, engine, system, factory, forge] = await Promise.all([
      this.invoke('store:get').catch(()=>({settings:{},chats:[],memories:[]})),
      this.invoke('knowledge:list').catch(()=>({libraries:[]})),
      this.invoke('knowledge-db:objectives').catch(()=>[]),
      this.invoke('knowledge-db:stats').catch(()=>null),
      this.invoke('engine:status').catch(()=>({online:false})),
      this.invoke('system:stats').catch(()=>null),
      this.invoke('factory:list').catch(()=>[]),
      this.forgeSnapshot().catch(error=>({ok:false,error:error.message,models:[],samplers:[],schedulers:[],upscalers:[],latentModes:[]})),
    ]);
    return {
      ok:true,
      web:this.status(),
      snapshot,
      knowledge,
      objectives,
      knowledgeStats,
      engine,
      system,
      factory,
      forge,
      webConfig:{ ...this.config },
    };
  }

  sseHeaders(res) {
    res.statusCode = 200;
    res.setHeader('Content-Type','text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control','no-cache, no-transform');
    res.setHeader('Connection','keep-alive');
    res.setHeader('X-Accel-Buffering','no');
    res.flushHeaders?.();
  }

  sse(res, event, payload) {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload ?? {})}\n\n`);
  }

  async handleChatStream(req,res,body) {
    const requestId = String(body.requestId || uid('webreq'));
    const payload = { ...(body.payload || body), requestId };
    delete payload.attachmentToken;
    if (body.attachmentToken) payload.messages = attachTokenToMessages(payload.messages, body.attachmentToken);
    this.sseHeaders(res);
    let terminal = false;
    let started = false;
    let closed = false;
    const sender = {
      isDestroyed:() => closed || res.destroyed,
      send:(channel, packet) => {
        const name = String(channel || 'event').replace(/:/g,'.');
        this.sse(res,name,packet || {});
        if (channel === 'chat:done' || channel === 'chat:error') {
          terminal = true;
          setTimeout(() => { if (!res.writableEnded) res.end(); }, 20);
        }
      },
    };
    req.on('close', async () => {
      closed = true;
      if (started && !terminal) await this.invoke('chat:stop',[requestId]).catch(()=>{});
    });
    try {
      const result = await this.invoke('chat:start',[payload],sender);
      started = true;
      this.sse(res,'chat.started',{ requestId, result:result || null });
      if (terminal && !res.writableEnded) res.end();
    } catch (error) {
      this.sse(res,'chat.error',{ requestId, error:error.message || String(error) });
      if (!res.writableEnded) res.end();
    }
  }

  async handle(req,res) {
    if (!isLoopback(req.socket?.remoteAddress)) return sendJson(res,403,{ok:false,error:'Nexa Web Control solo acepta conexiones locales.'});
    const requestUrl = new URL(req.url || '/', `http://${this.host}:${this.port}`);
    const route = requestUrl.pathname;

    try {
      if (req.method === 'GET' && route === '/') return this.serveFile(res,path.join(this.webDir,'index.html'));
      if (req.method === 'GET' && route === '/app.js') return this.serveFile(res,path.join(this.webDir,'app.js'));
      if (req.method === 'GET' && route === '/app.css') return this.serveFile(res,path.join(this.webDir,'app.css'));
      if (req.method === 'GET' && route.startsWith('/generated/')) {
        const name = path.basename(decodeURIComponent(route.slice('/generated/'.length)));
        return this.serveFile(res,path.join(this.generatedDir,name));
      }
      if (req.method === 'GET' && route === '/api/health') return sendJson(res,200,{...this.status(),forgeBaseUrl:this.config.forgeBaseUrl});
      if (req.method === 'GET' && route === '/api/session') return sendJson(res,200,{ok:true,token:this.token,version:this.version});
      if (!this.authorized(req)) return sendJson(res,401,{ok:false,error:'Sesión web inválida. Recarga la página.'});

      if (req.method === 'GET' && route === '/api/bootstrap') return sendJson(res,200,await this.bootstrap());
      if (req.method === 'GET' && route === '/api/forge/status') return sendJson(res,200,await this.forgeSnapshot());
      if (req.method === 'GET' && route === '/api/forge/progress') {
        const progress = await this.forgeGet('/sdapi/v1/progress?skip_current_image=true',5000).catch(()=>({progress:0,eta_relative:0}));
        return sendJson(res,200,{ok:true,...progress});
      }
      if (req.method === 'POST' && route === '/api/forge/interrupt') {
        await this.forgePost('/sdapi/v1/interrupt',{},10000).catch(()=>{});
        return sendJson(res,200,{ok:true});
      }
      if (req.method === 'POST' && route === '/api/forge/generate') {
        const body = await this.readJson(req);
        return sendJson(res,200,await this.generateForge(body));
      }
      if (req.method === 'POST' && route === '/api/web/settings') {
        const body = await this.readJson(req);
        const allowed = {};
        for (const key of ['forgeBaseUrl','forgeModel','forgeSampler','forgeScheduler','forgeUpscaler','forgeHiresUpscaler','steps','cfg','hiresFix','hiresScale','denoise','autoOpen','minimizeDesktop']) {
          if (Object.prototype.hasOwnProperty.call(body,key)) allowed[key] = body[key];
        }
        return sendJson(res,200,{ok:true,config:this.saveConfig(allowed)});
      }
      if (req.method === 'POST' && route === '/api/nexa/settings') {
        const body = await this.readJson(req);
        return sendJson(res,200,{ok:true,settings:await this.invoke('store:settings',[body])});
      }
      if (req.method === 'POST' && route === '/api/chat/save') {
        const body = await this.readJson(req);
        const chat = { ...(body.chat || {}) };
        if (body.attachmentToken && Array.isArray(chat.messages)) chat.messages = attachTokenToMessages(chat.messages,body.attachmentToken);
        return sendJson(res,200,{ok:true,chat:await this.invoke('store:chat:save',[chat])});
      }
      if (req.method === 'POST' && route === '/api/chat/delete') {
        const body = await this.readJson(req);
        return sendJson(res,200,{ok:true,result:await this.invoke('store:chat:delete',[String(body.id || '')])});
      }
      if (req.method === 'POST' && route === '/api/chat/stream') {
        const body = await this.readJson(req);
        return await this.handleChatStream(req,res,body);
      }
      if (req.method === 'POST' && route === '/api/chat/stop') {
        const body = await this.readJson(req);
        return sendJson(res,200,{ok:true,result:await this.invoke('chat:stop',[String(body.requestId || '')])});
      }
      if (req.method === 'POST' && route === '/api/attachments/stage') {
        const body = await this.readJson(req);
        return sendJson(res,200,await this.invoke('chat-attachments:stage',[{files:Array.isArray(body.files)?body.files:[]} ]));
      }
      if (req.method === 'POST' && route === '/api/memory/save') {
        const body = await this.readJson(req);
        return sendJson(res,200,{ok:true,memory:await this.invoke('store:memory:save',[body])});
      }
      if (req.method === 'POST' && route === '/api/memory/delete') {
        const body = await this.readJson(req);
        return sendJson(res,200,{ok:true,result:await this.invoke('store:memory:delete',[String(body.id || '')])});
      }
      if (req.method === 'POST' && route === '/api/knowledge/search') {
        const body = await this.readJson(req);
        return sendJson(res,200,{ok:true,results:await this.invoke('knowledge:search',[String(body.query||''),body.options||{}])});
      }
      if (req.method === 'POST' && route === '/api/knowledge-db/search') {
        const body = await this.readJson(req);
        return sendJson(res,200,{ok:true,results:await this.invoke('knowledge-db:search',[String(body.query||''),body.options||{}])});
      }
      if (req.method === 'POST' && route === '/api/research/topic') {
        const body = await this.readJson(req);
        return sendJson(res,200,{ok:true,result:await this.invoke('research:topic',[String(body.objectiveId||''),String(body.topic||''),body.options||{}])});
      }
      if (req.method === 'POST' && route === '/api/factory/start') {
        const body = await this.readJson(req);
        return sendJson(res,200,{ok:true,result:await this.invoke('factory:start',[String(body.id||'')])});
      }
      if (req.method === 'POST' && route === '/api/factory/pause') {
        const body = await this.readJson(req);
        return sendJson(res,200,{ok:true,result:await this.invoke('factory:pause',[String(body.id||'')])});
      }
      if (req.method === 'POST' && route === '/api/engine/action') {
        const body = await this.readJson(req);
        const map = {status:'engine:status',start:'engine:start',warm:'engine:warm',unload:'engine:unload'};
        const channel = map[String(body.action||'status')] || 'engine:status';
        return sendJson(res,200,{ok:true,result:await this.invoke(channel)});
      }

      return sendJson(res,404,{ok:false,error:'Endpoint no encontrado.'});
    } catch (error) {
      return sendJson(res,500,{ok:false,error:error.message || String(error)});
    }
  }
}

module.exports = {
  VERSION,
  DEFAULT_HOST,
  DEFAULT_PORT,
  NexaWebControlServer,
  encodeAttachmentToken,
  attachTokenToMessages,
  splitPromptSections,
  chooseImagePlan,
  chooseUpscaler,
  chooseHiresUpscaler,
};
