'use strict';
const apiBase = document.getElementById('apiBase');
const token = document.getElementById('token');
const status = document.getElementById('status');
const workerEnabled = document.getElementById('workerEnabled');
const show = (text, kind='') => { status.textContent=text; status.className='status ' + kind; };
function stripTrailingSlash(value) { const text=String(value || ''); return text.endsWith('/') ? text.slice(0,-1) : text; }

async function load() {
  const settings = await chrome.storage.local.get({ apiBase:'http://127.0.0.1:32145', token:'', workerEnabled:true });
  apiBase.value = settings.apiBase;
  token.value = settings.token;
  workerEnabled.checked = settings.workerEnabled !== false;
}

document.getElementById('toggleToken').addEventListener('click', () => {
  token.type = token.type === 'password' ? 'text' : 'password';
  document.getElementById('toggleToken').textContent = token.type === 'password' ? 'Mostrar token' : 'Ocultar token';
});

document.getElementById('save').addEventListener('click', async () => {
  try {
    const base = stripTrailingSlash(apiBase.value.trim()) || 'http://127.0.0.1:32145';
    const value = token.value.trim();
    await chrome.storage.local.set({ apiBase:base, token:value, workerEnabled:workerEnabled.checked });
    const response = await fetch(base + '/api/v1/auth/check', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${value}` }, body:'{}' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    show(`Conectado a Nexa AI ${data.appVersion || ''} / API ${data.apiVersion || '1'}. Browser Worker ${workerEnabled.checked ? 'ACTIVO' : 'PAUSADO'}.`, 'ok');
    if (workerEnabled.checked) chrome.runtime.sendMessage({ type:'nexa-worker-poll' }).catch(() => {});
  } catch (error) { show(error.message || String(error), 'error'); }
});
load();
