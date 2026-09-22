'use strict';

const $ = id => document.getElementById(id);

function show(message, kind = '') {
  const el = $('result');
  el.hidden = false;
  el.className = 'result ' + kind;
  el.textContent = message;
}

async function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra });
}

async function load() {
  const settings = await chrome.storage.local.get({ token:'', defaultObjectiveId:'' });
  $('pairingWarning').hidden = Boolean(settings.token);
  try {
    const health = await send('nexa-health');
    const online = Boolean(health?.ok && health?.result?.ok);
    $('status').textContent = online ? 'ONLINE' : 'OFFLINE';
    $('status').className = 'status ' + (online ? 'online' : 'offline');
    if (!settings.token) return;
    const auth = await send('nexa-auth-check');
    if (!auth?.ok) throw new Error(auth?.error || 'Pairing inválido.');
    const objectives = await send('nexa-objectives');
    const list = objectives?.result?.objectives || [];
    for (const objective of list) {
      const option = document.createElement('option');
      option.value = objective.id;
      option.textContent = objective.name;
      $('objectiveSelect').appendChild(option);
    }
    $('objectiveSelect').value = settings.defaultObjectiveId || '';
  } catch (error) {
    $('status').textContent = 'OFFLINE';
    $('status').className = 'status offline';
    show(error.message || String(error), 'error');
  }
}

async function capture(selectionOnly) {
  show('Enviando a Nexa…');
  const response = await send('nexa-capture', { payload:{
    objectiveId:$('objectiveSelect').value,
    topic:$('topicInput').value.trim(),
    selectionOnly,
  }});
  if (!response?.ok) throw new Error(response?.error || 'No se pudo guardar.');
  const result = response.result || {};
  await chrome.storage.local.set({ defaultObjectiveId:$('objectiveSelect').value });
  const duplicate = result.duplicate ? ' (ya existía; metadata actualizada)' : '';
  show('Guardado persistentemente en Nexa Knowledge' + duplicate + '.', 'ok');
}

$('saveSelection').addEventListener('click', () => capture(true).catch(e => show(e.message || String(e),'error')));
$('savePage').addEventListener('click', () => capture(false).catch(e => show(e.message || String(e),'error')));
$('saveMemory').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
    const result = await chrome.scripting.executeScript({ target:{ tabId:tab.id }, func:() => String(window.getSelection?.()?.toString?.() || '').trim() });
    const text = result?.[0]?.result || '';
    if (!text) throw new Error('Selecciona texto en la página primero.');
    const response = await send('nexa-memory', { text });
    if (!response?.ok) throw new Error(response?.error || 'No se pudo guardar la memoria.');
    show('Selección guardada en Memory.', 'ok');
  } catch (error) { show(error.message || String(error),'error'); }
});
$('optionsBtn').addEventListener('click', () => send('nexa-options'));

load();
