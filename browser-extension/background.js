'use strict';

const DEFAULTS = Object.freeze({
  apiBase: 'http://127.0.0.1:32145',
  token: '',
  defaultObjectiveId: '',
  workerEnabled: true,
  lastWorkerRun: '',
  lastWorkerError: '',
});

async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
}
function stripTrailingSlash(value) {
  const text = String(value || '');
  return text.endsWith('/') ? text.slice(0, -1) : text;
}
async function api(path, options = {}) {
  const settings = await getSettings();
  const headers = { 'Content-Type':'application/json', ...(options.headers || {}) };
  if (settings.token) headers.Authorization = `Bearer ${settings.token}`;
  const response = await fetch(stripTrailingSlash(settings.apiBase) + path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `Nexa API HTTP ${response.status}`);
  return payload;
}
function decodeHtml(value) {
  return String(value || '')
    .replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>')
    .replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&nbsp;',' ');
}
function stripTags(value) {
  return decodeHtml(String(value || '').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
}
function xmlValue(block, tag) {
  const pattern = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i');
  const match = String(block || '').match(pattern);
  return match ? stripTags(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')) : '';
}
function safeUrl(value) {
  try { const u = new URL(String(value || '')); return /^https?:$/.test(u.protocol) ? u.toString() : ''; } catch (_) { return ''; }
}
function domainOf(value) { try { return new URL(value).hostname.toLowerCase(); } catch (_) { return ''; } }
function dedupe(items, max = 10) {
  const out = [], seen = new Set();
  for (const item of items || []) {
    const url = safeUrl(item.url);
    if (!url || seen.has(url)) continue;
    seen.add(url); out.push({ ...item, url, domain:domainOf(url) });
    if (out.length >= max) break;
  }
  return out;
}
function parseBingRss(xml, max = 10) {
  const results = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRe.exec(String(xml || ''))) && results.length < max * 2) {
    const title = xmlValue(match[1],'title');
    const url = safeUrl(xmlValue(match[1],'link'));
    const snippet = xmlValue(match[1],'description');
    if (title && url) results.push({ title, url, snippet, provider:'Chrome/Bing RSS' });
  }
  return dedupe(results,max);
}
async function fetchText(url, timeoutMs = 15000, maxChars = 300000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal:controller.signal, credentials:'omit', redirect:'follow', headers:{ 'Accept':'text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.7' } });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const text = (await response.text()).slice(0,maxChars);
    return { text, contentType:String(response.headers.get('content-type') || '') };
  } finally { clearTimeout(timer); }
}
async function browserResearch(query, maxSources = 5) {
  const max = Math.max(1, Math.min(10, Number(maxSources) || 5));
  const searchUrl = 'https://www.bing.com/search?format=rss&q=' + encodeURIComponent(String(query || '').trim());
  const search = await fetchText(searchUrl,15000,500000);
  const ranked = parseBingRss(search.text,Math.max(max*2,8));
  const sources = [];
  for (const item of ranked) {
    if (sources.length >= max) break;
    let text = item.snippet || '', pageError = '';
    try {
      const page = await fetchText(item.url,12000,900000);
      text = /html|xhtml/i.test(page.contentType) || !page.contentType ? stripTags(page.text).slice(0,14000) : String(page.text || '').replace(/\s+/g,' ').slice(0,14000);
    } catch (error) { pageError = error.message || String(error); }
    sources.push({ ...item, text:text || item.snippet || '', pageError, accessDate:new Date().toISOString() });
  }
  return { query:String(query || ''), results:sources, provider:'Nexa AI Browser Bridge / Chrome' };
}

async function extractTab(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const selection = String(window.getSelection?.()?.toString?.() || '').trim();
      const bodyText = String(document.body?.innerText || '').trim();
      const description = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
      const canonical = document.querySelector('link[rel="canonical"]')?.href || location.href;
      return {
        title: document.title || location.hostname,
        url: location.href,
        canonical,
        selection,
        text: bodyText.slice(0, 180000),
        metadata: { lang:document.documentElement.lang || '', description:String(description).slice(0,2000), captured_at:new Date().toISOString() },
      };
    },
  });
  return results?.[0]?.result || null;
}
async function sendCapture({ tabId, objectiveId = '', topic = '', selectionOnly = false, explicitSelection = '' } = {}) {
  const tabs = tabId ? [{ id:tabId }] : await chrome.tabs.query({ active:true, currentWindow:true });
  const tab = tabs[0];
  if (!tab?.id) throw new Error('No hay una pestaña activa disponible.');
  let page = null;
  try { page = await extractTab(tab.id); }
  catch (error) {
    if (!explicitSelection) throw new Error('Chrome no permitió leer esta página. Prueba en una página web normal: ' + (error.message || String(error)));
    page = { title:tab.title || 'Selección', url:tab.url || '', selection:explicitSelection, text:explicitSelection, metadata:{} };
  }
  if (explicitSelection) page.selection = explicitSelection;
  const selected = String(page.selection || '').trim();
  const content = selectionOnly ? selected : String(page.text || '').trim();
  if (!content) throw new Error(selectionOnly ? 'No hay texto seleccionado.' : 'No se encontró texto legible en esta página.');
  const settings = await getSettings();
  return api('/api/v1/captures', { method:'POST', body:JSON.stringify({
    objectiveId: objectiveId || settings.defaultObjectiveId || '', topic:String(topic || '').trim(), captureType:selectionOnly ? 'selection' : 'page',
    title:page.title || tab.title || '', url:page.canonical || page.url || tab.url || '', selectedText:selected, text:selectionOnly ? selected : content,
    metadata:page.metadata || {}, saveToKnowledge:true, verificationStatus:'PARTIAL', confidence:0.55,
  }) });
}
async function sendMemory(text) {
  const value = String(text || '').trim();
  if (!value) throw new Error('No hay texto para guardar como memoria.');
  return api('/api/v1/memory', { method:'POST', body:JSON.stringify({ text:value }) });
}

async function executeCommand(command) {
  const type = String(command?.command_type || '');
  const payload = command?.payload || {};
  if (type === 'web_research') return browserResearch(payload.query || '', payload.maxSources || 5);
  if (type === 'fetch_url') {
    const url = safeUrl(payload.url);
    if (!url) throw new Error('URL inválida.');
    const page = await fetchText(url,15000,900000);
    return { url, text:(/html|xhtml/i.test(page.contentType) ? stripTags(page.text) : page.text).slice(0,180000), contentType:page.contentType };
  }
  if (type === 'open_url') {
    const url = safeUrl(payload.url);
    if (!url) throw new Error('URL inválida.');
    const tab = await chrome.tabs.create({ url, active:Boolean(payload.active) });
    return { opened:true, tabId:tab.id || null, url };
  }
  throw new Error('Comando de navegador no soportado: ' + type);
}

let polling = false;
async function pollCommands() {
  if (polling) return;
  polling = true;
  try {
    const settings = await getSettings();
    if (!settings.workerEnabled || !settings.token) return;
    await api('/api/v1/worker/heartbeat', { method:'POST', body:'{}' });
    const next = await api('/api/v1/commands/next');
    const command = next.command;
    if (!command) {
      await chrome.storage.local.set({ lastWorkerRun:new Date().toISOString(), lastWorkerError:'' });
      return;
    }
    try {
      const result = await executeCommand(command);
      await api('/api/v1/commands/result', { method:'POST', body:JSON.stringify({ id:command.id, ok:true, result }) });
      await chrome.storage.local.set({ lastWorkerRun:new Date().toISOString(), lastWorkerError:'' });
      setTimeout(() => pollCommands(), 1200);
    } catch (error) {
      await api('/api/v1/commands/result', { method:'POST', body:JSON.stringify({ id:command.id, ok:false, error:error.message || String(error), result:{} }) }).catch(() => {});
      await chrome.storage.local.set({ lastWorkerRun:new Date().toISOString(), lastWorkerError:error.message || String(error) });
    }
  } catch (error) {
    await chrome.storage.local.set({ lastWorkerRun:new Date().toISOString(), lastWorkerError:error.message || String(error) });
  } finally { polling = false; }
}

function installMenusAndWorker() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id:'nexa-save-selection', title:'Guardar selección en Nexa Knowledge', contexts:['selection'] });
    chrome.contextMenus.create({ id:'nexa-save-memory', title:'Guardar selección como memoria de Nexa', contexts:['selection'] });
    chrome.contextMenus.create({ id:'nexa-save-page', title:'Guardar página en Nexa Knowledge', contexts:['page'] });
  });
  chrome.alarms.create('nexa-browser-worker', { periodInMinutes:0.5 });
}
chrome.runtime.onInstalled.addListener(() => { installMenusAndWorker(); pollCommands(); });
chrome.runtime.onStartup.addListener(() => { installMenusAndWorker(); pollCommands(); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'nexa-browser-worker') pollCommands(); });

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'nexa-save-selection') await sendCapture({ tabId:tab?.id, selectionOnly:true, explicitSelection:info.selectionText || '' });
    else if (info.menuItemId === 'nexa-save-memory') await sendMemory(info.selectionText || '');
    else if (info.menuItemId === 'nexa-save-page') await sendCapture({ tabId:tab?.id, selectionOnly:false });
    await chrome.action.setBadgeText({ text:'✓' });
    await chrome.action.setBadgeBackgroundColor({ color:'#8ff52d' });
    setTimeout(() => chrome.action.setBadgeText({ text:'' }), 1800);
  } catch (error) {
    await chrome.storage.local.set({ lastError:error.message || String(error) });
    await chrome.action.setBadgeText({ text:'!' });
    await chrome.action.setBadgeBackgroundColor({ color:'#ff5f6d' });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === 'nexa-health') return fetch((await getSettings()).apiBase + '/api/v1/health').then(r => r.json());
    if (message?.type === 'nexa-auth-check') return api('/api/v1/auth/check', { method:'POST', body:'{}' });
    if (message?.type === 'nexa-objectives') return api('/api/v1/objectives');
    if (message?.type === 'nexa-capture') return sendCapture(message.payload || {});
    if (message?.type === 'nexa-memory') return sendMemory(message.text || '');
    if (message?.type === 'nexa-worker-poll') { await pollCommands(); return { ok:true }; }
    if (message?.type === 'nexa-worker-state') return getSettings();
    if (message?.type === 'nexa-options') { await chrome.runtime.openOptionsPage(); return { ok:true }; }
    return { ok:false, error:'Mensaje no reconocido.' };
  })().then(result => sendResponse({ ok:true, result })).catch(error => sendResponse({ ok:false, error:error.message || String(error) }));
  return true;
});

pollCommands();
