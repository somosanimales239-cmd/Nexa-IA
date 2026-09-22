'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API_VERSION = '1';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 32145;
const MAX_BODY_BYTES = 1024 * 1024;

function nowIso() { return new Date().toISOString(); }
function token() { return crypto.randomBytes(32).toString('base64url'); }
function asText(value, max = 200000) { return String(value ?? '').trim().slice(0, max); }
function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}
function cors(req, res) {
  const origin = String(req.headers.origin || '');
  if (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    // The bridge is loopback-only and all writes require a secret token.
    // This keeps extension testing simple while the token remains the real authorization boundary.
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Nexa-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

class BrowserBridge {
  constructor({ dataDir, store, knowledgeDb, appVersion = '0.0.0', host = DEFAULT_HOST, port = DEFAULT_PORT, onCapture = null } = {}) {
    if (!dataDir || !store || !knowledgeDb) throw new Error('BrowserBridge requires dataDir, store and knowledgeDb.');
    this.dataDir = dataDir;
    this.store = store;
    this.knowledgeDb = knowledgeDb;
    this.appVersion = appVersion;
    this.host = host;
    this.port = Number.isInteger(Number(port)) ? Number(port) : DEFAULT_PORT;
    this.onCapture = typeof onCapture === 'function' ? onCapture : null;
    this.server = null;
    this.lastError = '';
    this.startedAt = '';
    this.extensionLastHeartbeat = '';
    this.configPath = path.join(dataDir, 'nexa-browser-bridge.json');
    this.config = this.loadConfig();
  }

  loadConfig() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    let parsed = null;
    try { parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf8')); } catch (_) {}
    const config = {
      apiVersion: API_VERSION,
      enabled: parsed?.enabled !== false,
      port: Number.isInteger(Number(parsed?.port)) ? Number(parsed.port) : this.port,
      pairingToken: asText(parsed?.pairingToken, 300) || token(),
      createdAt: parsed?.createdAt || nowIso(),
      updatedAt: nowIso(),
    };
    this.port = config.port;
    this.writeConfig(config);
    return config;
  }

  writeConfig(config = this.config) {
    const tmp = `${this.configPath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, this.configPath);
  }

  regenerateToken() {
    this.config.pairingToken = token();
    this.config.updatedAt = nowIso();
    this.writeConfig();
    return this.status({ includeToken: true });
  }

  authorized(req) {
    const bearer = String(req.headers.authorization || '');
    const headerToken = String(req.headers['x-nexa-token'] || '');
    const supplied = bearer.toLowerCase().startsWith('bearer ') ? bearer.slice(7).trim() : headerToken.trim();
    if (!supplied || !this.config.pairingToken) return false;
    const a = Buffer.from(supplied);
    const b = Buffer.from(this.config.pairingToken);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  async readBody(req) {
    return new Promise((resolve, reject) => {
      let total = 0;
      const chunks = [];
      req.on('data', chunk => {
        total += chunk.length;
        if (total > MAX_BODY_BYTES) {
          reject(new Error('Payload demasiado grande.'));
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

  status({ includeToken = false } = {}) {
    const address = this.server?.address?.();
    const actualPort = address && typeof address === 'object' ? address.port : this.port;
    const heartbeatMs = this.extensionLastHeartbeat ? (Date.now() - new Date(this.extensionLastHeartbeat).getTime()) : Infinity;
    return {
      ok: Boolean(this.server?.listening),
      service: 'Nexa Browser Bridge',
      apiVersion: API_VERSION,
      appVersion: this.appVersion,
      host: this.host,
      port: actualPort,
      baseUrl: `http://${this.host}:${actualPort}`,
      enabled: this.config.enabled !== false,
      startedAt: this.startedAt,
      lastError: this.lastError,
      extensionLastHeartbeat: this.extensionLastHeartbeat,
      extensionWorkerOnline: Number.isFinite(heartbeatMs) && heartbeatMs < 95000,
      ...(includeToken ? { pairingToken: this.config.pairingToken } : {}),
    };
  }

  start() {
    if (this.server?.listening) return Promise.resolve(this.status());
    if (this.config.enabled === false) return Promise.resolve(this.status());
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handle(req, res));
      this.server.on('error', error => {
        this.lastError = error.message || String(error);
        reject(error);
      });
      this.server.listen(this.port, this.host, () => {
        this.lastError = '';
        this.startedAt = nowIso();
        const address = this.server.address();
        if (address && typeof address === 'object') this.port = address.port;
        resolve(this.status());
      });
    });
  }

  stop() {
    if (!this.server) return Promise.resolve();
    return new Promise(resolve => {
      const current = this.server;
      this.server = null;
      current.close(() => resolve());
    });
  }

  async handle(req, res) {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    const requestUrl = new URL(req.url || '/', `http://${this.host}:${this.port}`);
    const route = requestUrl.pathname;

    try {
      if (req.method === 'GET' && route === '/api/v1/health') {
        return json(res, 200, { ...this.status(), database: Boolean(this.knowledgeDb), tokenRequired: true });
      }
      if (!this.authorized(req)) return json(res, 401, { ok:false, error:'Nexa pairing token inválido o ausente.' });

      if (req.method === 'POST' && route === '/api/v1/auth/check') {
        return json(res, 200, { ok:true, apiVersion:API_VERSION, appVersion:this.appVersion });
      }
      if (req.method === 'POST' && route === '/api/v1/worker/heartbeat') {
        this.extensionLastHeartbeat = nowIso();
        return json(res, 200, { ok:true, worker:'browser-extension', heartbeat:this.extensionLastHeartbeat });
      }
      if (req.method === 'GET' && route === '/api/v1/objectives') {
        const objectives = this.knowledgeDb.listObjectives().map(o => ({
          id:o.id, type:o.type, name:o.name, category:o.category,
          make:o.make, model:o.model, year:o.year, engine_code:o.engine_code, market:o.market,
          verified_count:o.verified_count, partial_count:o.partial_count, missing_count:o.missing_count,
        }));
        return json(res, 200, { ok:true, objectives });
      }
      if (req.method === 'GET' && route === '/api/v1/captures') {
        const limit = Math.max(1, Math.min(100, Number(requestUrl.searchParams.get('limit')) || 20));
        return json(res, 200, { ok:true, captures:this.knowledgeDb.listBrowserCaptures(limit) });
      }
      if (req.method === 'POST' && route === '/api/v1/captures') {
        const body = await this.readBody(req);
        const result = this.knowledgeDb.saveBrowserCapture(body || {});
        if (this.onCapture) {
          try { this.onCapture({ type:'knowledge', ...result }); } catch (_) {}
        }
        return json(res, 200, { ok:true, ...result });
      }
      if (req.method === 'POST' && route === '/api/v1/memory') {
        const body = await this.readBody(req);
        const text = asText(body?.text, 6000);
        if (!text) return json(res, 400, { ok:false, error:'La memoria no puede estar vacía.' });
        const memory = this.store.addMemory({ text });
        if (this.onCapture) {
          try { this.onCapture({ type:'memory', memory }); } catch (_) {}
        }
        return json(res, 200, { ok:true, memory });
      }
      if (req.method === 'GET' && route === '/api/v1/commands/next') {
        const command = this.knowledgeDb.claimNextBrowserCommand();
        return json(res, 200, { ok:true, command:command || null });
      }
      if (req.method === 'POST' && route === '/api/v1/commands/result') {
        const body = await this.readBody(req);
        const command = this.knowledgeDb.completeBrowserCommand(body?.id, body || {});
        return json(res, 200, { ok:true, command });
      }
      return json(res, 404, { ok:false, error:'Endpoint no encontrado.' });
    } catch (error) {
      return json(res, 500, { ok:false, error:error.message || String(error) });
    }
  }
}

module.exports = { BrowserBridge, API_VERSION, DEFAULT_HOST, DEFAULT_PORT };
