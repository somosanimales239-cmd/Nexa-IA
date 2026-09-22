'use strict';

const DEFAULTS = Object.freeze({
  apiBase: 'http://127.0.0.1:32145',
  token: '',
  defaultObjectiveId: '',
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
        metadata: {
          lang: document.documentElement.lang || '',
          description: String(description).slice(0, 2000),
          captured_at: new Date().toISOString(),
        },
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
  return api('/api/v1/captures', {
    method:'POST',
    body:JSON.stringify({
      objectiveId: objectiveId || settings.defaultObjectiveId || '',
      topic: String(topic || '').trim(),
      captureType: selectionOnly ? 'selection' : 'page',
      title:page.title || tab.title || '',
      url:page.canonical || page.url || tab.url || '',
      selectedText:selected,
      text:selectionOnly ? selected : content,
      metadata:page.metadata || {},
      saveToKnowledge:true,
      verificationStatus:'PARTIAL',
      confidence:0.55,
    }),
  });
}

async function sendMemory(text) {
  const value = String(text || '').trim();
  if (!value) throw new Error('No hay texto para guardar como memoria.');
  return api('/api/v1/memory', { method:'POST', body:JSON.stringify({ text:value }) });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id:'nexa-save-selection', title:'Guardar selección en Nexa Knowledge', contexts:['selection'] });
    chrome.contextMenus.create({ id:'nexa-save-memory', title:'Guardar selección como memoria de Nexa', contexts:['selection'] });
    chrome.contextMenus.create({ id:'nexa-save-page', title:'Guardar página en Nexa Knowledge', contexts:['page'] });
  });
});

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
    if (message?.type === 'nexa-options') { await chrome.runtime.openOptionsPage(); return { ok:true }; }
    return { ok:false, error:'Mensaje no reconocido.' };
  })().then(result => sendResponse({ ok:true, result })).catch(error => sendResponse({ ok:false, error:error.message || String(error) }));
  return true;
});
