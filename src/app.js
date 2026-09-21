'use strict';

const state = {
  settings: {},
  chats: [],
  memories: [],
  currentChatId: null,
  activeRequestId: null,
  activeAssistantMessageId: null,
  statsTimer: null,
  lastUnityDetected: false,
  autoModeBusy: false,
};

const $ = selector => document.querySelector(selector);
const els = {};

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function formatTime(iso) {
  try {
    return new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  } catch (_) { return ''; }
}

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '';
  if (diff < 60000) return 'ahora';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}

function bytesLabel(bytes) {
  const gb = Number(bytes || 0) / 1024 / 1024 / 1024;
  return gb >= 1 ? `${gb.toFixed(gb >= 10 ? 1 : 2)} GB` : `${(Number(bytes || 0) / 1024 / 1024).toFixed(0)} MB`;
}

function mbLabel(mb) {
  return Number(mb || 0) >= 1024 ? `${(Number(mb) / 1024).toFixed(2)} GB` : `${Math.round(Number(mb || 0))} MB`;
}

function toast(message, type = '') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  els.toastHost.appendChild(node);
  setTimeout(() => node.remove(), 3600);
}

function currentChat() {
  return state.chats.find(chat => chat.id === state.currentChatId) || null;
}

function ensureChat() {
  let chat = currentChat();
  if (chat) return chat;
  chat = {
    id: uid('chat'), title: 'Nuevo chat', createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), messages: [],
  };
  state.chats.unshift(chat);
  state.currentChatId = chat.id;
  renderChats();
  renderCurrentChat();
  return chat;
}

async function persistChat(chat) {
  const saved = await window.nexa.store.saveChat(chat);
  const index = state.chats.findIndex(item => item.id === saved.id);
  if (index >= 0) state.chats[index] = saved;
  else state.chats.unshift(saved);
  state.chats.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  renderChats();
}

function autoTitle(chat) {
  if (!chat || chat.title !== 'Nuevo chat') return;
  const firstUser = chat.messages.find(message => message.role === 'user');
  if (!firstUser) return;
  const compact = firstUser.content.replace(/\s+/g, ' ').trim();
  chat.title = compact.slice(0, 58) || 'Nuevo chat';
  if (compact.length > 58) chat.title += '…';
  els.chatTitle.value = chat.title;
}

function renderChats() {
  const query = els.chatSearch.value.trim().toLowerCase();
  const chats = state.chats
    .slice()
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .filter(chat => !query || chat.title.toLowerCase().includes(query) || chat.messages.some(m => m.content.toLowerCase().includes(query)));
  if (!chats.length) {
    els.chatList.innerHTML = `<div class="empty-list">${query ? 'No hay coincidencias.' : 'Todavía no hay conversaciones.'}</div>`;
    return;
  }
  els.chatList.innerHTML = chats.map(chat => `
    <div class="chat-item ${chat.id === state.currentChatId ? 'active' : ''}" data-chat-id="${escapeHtml(chat.id)}">
      <div>
        <div class="chat-item-title">${escapeHtml(chat.title)}</div>
        <div class="chat-item-time">${relativeTime(chat.updatedAt)}</div>
      </div>
      <button class="chat-delete" data-delete-chat="${escapeHtml(chat.id)}" title="Eliminar">×</button>
    </div>`).join('');
}

function renderCurrentChat() {
  const chat = currentChat();
  els.chatTitle.value = chat?.title || 'Nuevo chat';
  if (!chat || !chat.messages.length) {
    els.welcomeState.hidden = false;
    els.messages.hidden = true;
    els.messages.innerHTML = '';
    return;
  }
  els.welcomeState.hidden = true;
  els.messages.hidden = false;
  els.messages.innerHTML = chat.messages.map(message => `
    <article class="message ${escapeHtml(message.role)}" data-message-id="${escapeHtml(message.id)}">
      <div class="avatar">${message.role === 'assistant' ? 'N' : 'TÚ'}</div>
      <div>
        <div class="message-head">
          <span class="message-author">${message.role === 'assistant' ? 'Nexa AI' : 'Tú'}</span>
          <span class="message-time">${formatTime(message.createdAt)}</span>
        </div>
        <div class="message-content">${escapeHtml(message.content)}</div>
        <div class="message-actions">
          <button class="message-action" data-memory-message="${escapeHtml(message.id)}">Guardar en memoria</button>
          <button class="message-action" data-copy-message="${escapeHtml(message.id)}">Copiar</button>
        </div>
      </div>
    </article>`).join('');
  requestAnimationFrame(() => { els.messages.scrollTop = els.messages.scrollHeight; });
}

function updateStreamingMessage(content) {
  const chat = currentChat();
  if (!chat || !state.activeAssistantMessageId) return;
  const message = chat.messages.find(item => item.id === state.activeAssistantMessageId);
  if (!message) return;
  message.content += content;
  const node = els.messages.querySelector(`[data-message-id="${CSS.escape(message.id)}"] .message-content`);
  if (node) node.textContent = message.content;
  else renderCurrentChat();
  els.messages.scrollTop = els.messages.scrollHeight;
}

function setGenerating(active) {
  els.generationBanner.hidden = !active;
  els.sendBtn.disabled = active;
  els.promptInput.disabled = active;
  if (!active) els.promptInput.focus();
}

async function sendMessage() {
  const text = els.promptInput.value.trim();
  if (!text || state.activeRequestId) return;
  const chat = ensureChat();
  const now = new Date().toISOString();
  chat.messages.push({ id: uid('msg'), role: 'user', content: text, createdAt: now });
  autoTitle(chat);
  chat.messages.push({ id: uid('msg'), role: 'assistant', content: '', createdAt: new Date().toISOString() });
  state.activeAssistantMessageId = chat.messages[chat.messages.length - 1].id;
  els.promptInput.value = '';
  resizePrompt();
  renderCurrentChat();
  await persistChat(chat);

  const requestId = uid('req');
  state.activeRequestId = requestId;
  setGenerating(true);
  try {
    const result = await window.nexa.chat.start({
      requestId,
      messages: chat.messages.filter(message => message.id !== state.activeAssistantMessageId).map(message => ({ role: message.role, content: message.content })),
    });
    if (!result?.ok) throw new Error(result?.error || 'No se pudo iniciar la respuesta.');
  } catch (error) {
    finishWithError(error.message || String(error));
  }
}

async function finishGeneration(stats) {
  const chat = currentChat();
  const message = chat?.messages.find(item => item.id === state.activeAssistantMessageId);
  if (message && !message.content.trim()) message.content = '(La respuesta terminó sin contenido.)';
  if (chat) await persistChat(chat);
  state.activeRequestId = null;
  state.activeAssistantMessageId = null;
  setGenerating(false);
  renderCurrentChat();
  if (stats?.evalCount && stats?.evalDuration) {
    const tokensPerSecond = stats.evalCount / (stats.evalDuration / 1e9);
    els.composerHint.textContent = `Local • ${state.settings.contextLength} ctx • ${tokensPerSecond.toFixed(1)} tok/s`;
  }
  refreshStats();
}

function finishWithError(message) {
  const chat = currentChat();
  const assistant = chat?.messages.find(item => item.id === state.activeAssistantMessageId);
  if (assistant && !assistant.content) assistant.content = `Error local: ${message}`;
  if (chat) persistChat(chat).catch(() => {});
  state.activeRequestId = null;
  state.activeAssistantMessageId = null;
  setGenerating(false);
  renderCurrentChat();
  toast(message, 'error');
}

async function stopGeneration() {
  if (!state.activeRequestId) return;
  await window.nexa.chat.stop(state.activeRequestId);
  await finishGeneration();
}

async function selectMode(mode, { silent = false } = {}) {
  if (!['fast', 'light'].includes(mode) || mode === state.settings.profile) return;
  state.settings.profile = mode;
  updateModeUi();
  await window.nexa.store.saveSettings({ profile: mode });
  const unload = await window.nexa.engine.unload();
  if (!silent) {
    toast(mode === 'fast'
      ? 'Modo Rápido activado. El modelo se recargará usando la selección automática de GPU.'
      : `Modo Ligero activado. El modelo se recargará con ${state.settings.lightGpuLayers} capas en GPU.`, unload.ok ? 'success' : '');
  }
  refreshStats();
}

function updateModeUi() {
  const isFast = state.settings.profile === 'fast';
  els.fastModeBtn.classList.toggle('active', isFast);
  els.lightModeBtn.classList.toggle('active', !isFast);
  els.profileBadge.textContent = isFast ? 'RÁPIDO' : 'LIGERO';
  els.profileBadge.className = `badge ${isFast ? 'lime' : 'blue'}`;
  els.profileDescription.textContent = isFast
    ? 'Ollama decide automáticamente cuántas capas colocar en GPU para dar la mayor velocidad posible.'
    : `Nexa limita la IA a ${state.settings.lightGpuLayers} capas GPU para dejar más VRAM a Unity y otros programas.`;
}

function renderMemories() {
  els.memoryCount.textContent = `${state.memories.length} ${state.memories.length === 1 ? 'recuerdo' : 'recuerdos'}`;
  els.includeMemories.checked = state.settings.includeMemories !== false;
  if (!state.memories.length) {
    els.memoryList.innerHTML = '<div class="empty-list">No hay memoria guardada todavía.</div>';
    return;
  }
  els.memoryList.innerHTML = state.memories.map(memory => `
    <div class="memory-item" data-memory-id="${escapeHtml(memory.id)}">
      <div class="memory-text">${escapeHtml(memory.text)}</div>
      <div class="memory-meta">
        <label><input type="checkbox" data-toggle-memory="${escapeHtml(memory.id)}" ${memory.enabled ? 'checked' : ''}> activa</label>
        <button class="memory-delete" data-delete-memory="${escapeHtml(memory.id)}">Eliminar</button>
      </div>
    </div>`).join('');
}

async function saveMemory(text, existing = null) {
  const content = String(text || '').trim();
  if (!content) return;
  try {
    const item = await window.nexa.store.saveMemory({ ...(existing || {}), text: content });
    const index = state.memories.findIndex(memory => memory.id === item.id);
    if (index >= 0) state.memories[index] = item;
    else state.memories.unshift(item);
    renderMemories();
    toast('Memoria guardada localmente.', 'success');
  } catch (error) { toast(error.message || String(error), 'error'); }
}

function showPanel(name) {
  document.querySelectorAll('.panel').forEach(panel => panel.classList.toggle('active', panel.dataset.panelView === name));
  document.querySelectorAll('.nav-button').forEach(button => button.classList.toggle('active', button.dataset.panel === name));
  const meta = {
    system: ['Sistema', 'Estado local en tiempo real'],
    memory: ['Memoria', 'Recuerdos persistentes'],
    settings: ['Ajustes', 'Motor, modelo y rendimiento'],
  }[name];
  els.inspectorTitle.textContent = meta[0];
  els.inspectorSubtitle.textContent = meta[1];
}

function fillSettings() {
  els.settingModel.value = state.settings.model || '';
  els.settingBaseUrl.value = state.settings.baseUrl || '';
  els.settingOllamaExe.value = state.settings.ollamaExe || '';
  els.settingModelsPath.value = state.settings.modelsPath || '';
  els.settingContext.value = state.settings.contextLength || 4096;
  els.settingLightLayers.value = state.settings.lightGpuLayers ?? 6;
  els.settingKeepAlive.value = state.settings.keepAlive || '5m';
  els.settingAutoUnity.checked = Boolean(state.settings.autoUnityMode);
  els.includeMemories.checked = state.settings.includeMemories !== false;
  els.modelText.textContent = state.settings.model || 'gpt-oss:20b';
  els.composerHint.textContent = `Local • ${state.settings.contextLength || 4096} ctx`;
}

async function saveSettings(event) {
  event.preventDefault();
  const patch = {
    model: els.settingModel.value.trim(),
    baseUrl: els.settingBaseUrl.value.trim(),
    ollamaExe: els.settingOllamaExe.value.trim(),
    modelsPath: els.settingModelsPath.value.trim(),
    contextLength: Number(els.settingContext.value),
    lightGpuLayers: Number(els.settingLightLayers.value),
    keepAlive: els.settingKeepAlive.value.trim() || '5m',
    autoUnityMode: els.settingAutoUnity.checked,
  };
  state.settings = { ...state.settings, ...(await window.nexa.store.saveSettings(patch)) };
  fillSettings();
  updateModeUi();
  toast('Ajustes guardados.', 'success');
  refreshStats();
}

function setBar(element, value, max) {
  const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  element.style.width = `${percent.toFixed(1)}%`;
}

async function maybeAutoUnity(stats) {
  if (!state.settings.autoUnityMode || state.autoModeBusy) {
    state.lastUnityDetected = Boolean(stats.unityDetected);
    return;
  }
  const detected = Boolean(stats.unityDetected);
  if (detected === state.lastUnityDetected) return;
  state.lastUnityDetected = detected;
  const desired = detected ? 'light' : 'fast';
  if (desired === state.settings.profile) return;
  state.autoModeBusy = true;
  try {
    await selectMode(desired, { silent: true });
    toast(detected ? 'Unity detectado: Nexa cambió a Modo Ligero.' : 'Unity cerrado: Nexa volvió a Modo Rápido.', 'success');
  } finally { state.autoModeBusy = false; }
}

async function refreshStats() {
  try {
    const stats = await window.nexa.system.stats();
    const online = Boolean(stats.ollama?.online);
    els.engineDot.className = `status-dot ${online ? 'online' : 'offline'}`;
    els.engineText.textContent = online ? 'Ollama local conectado' : 'Ollama desconectado';
    els.ollamaBadge.textContent = online ? (stats.ollama.selectedRunning ? '20B cargado' : 'Online') : 'Offline';
    els.ollamaBadge.className = `badge ${online ? 'lime' : 'red'}`;
    els.modelText.textContent = state.settings.model;

    const ram = stats.ram || {};
    els.ramLabel.textContent = `${ram.usedGb ?? '—'} / ${ram.totalGb ?? '—'} GB`;
    els.aiRam.textContent = `${ram.aiGb ?? 0} GB`;
    els.unityRam.textContent = `${ram.unityGb ?? 0} GB`;
    setBar(els.ramBar, Number(ram.usedGb || 0), Number(ram.totalGb || 0));

    const gpu = stats.gpu || {};
    if (gpu.available) {
      els.vramLabel.textContent = `${mbLabel(gpu.memoryUsedMb)} / ${mbLabel(gpu.memoryTotalMb)}`;
      els.aiVram.textContent = mbLabel(gpu.aiVramMb);
      els.otherVram.textContent = mbLabel(gpu.otherVramMb);
      els.gpuUsage.textContent = `${gpu.utilization || 0}%`;
      els.gpuTemp.textContent = `${gpu.temperature || 0} °C`;
      setBar(els.vramBar, Number(gpu.memoryUsedMb || 0), Number(gpu.memoryTotalMb || 0));
    } else {
      els.vramLabel.textContent = 'No disponible';
      els.aiVram.textContent = '—'; els.otherVram.textContent = '—'; els.gpuUsage.textContent = '—'; els.gpuTemp.textContent = '—';
      setBar(els.vramBar, 0, 1);
    }

    els.unityBadge.textContent = stats.unityDetected ? 'Detectado' : 'No detectado';
    els.unityBadge.className = `badge ${stats.unityDetected ? 'blue' : 'muted'}`;
    els.unityAdvice.textContent = stats.unityDetected
      ? `Unity está usando ${ram.unityGb || 0} GB de RAM. ${state.settings.profile === 'light' ? 'Modo Ligero está activo.' : 'Puedes activar Ligero para liberar VRAM.'}`
      : 'Cuando Unity esté abierto, el modo Ligero deja más VRAM disponible.';

    await maybeAutoUnity(stats);
  } catch (error) {
    els.engineDot.className = 'status-dot offline';
    els.engineText.textContent = 'Estado no disponible';
  }
}

async function startEngine() {
  toast('Iniciando Ollama…');
  const result = await window.nexa.engine.start();
  if (result.ok) toast(result.alreadyRunning ? 'Ollama ya estaba funcionando.' : 'Ollama iniciado.', 'success');
  else toast(result.error || 'No se pudo iniciar Ollama.', 'error');
  refreshStats();
}

async function warmModel() {
  toast(`Cargando ${state.settings.model}… puede tardar en el disco externo.`);
  const result = await window.nexa.engine.warm();
  if (result.ok) toast('Modelo cargado y listo.', 'success');
  else toast(result.error || 'No se pudo cargar el modelo.', 'error');
  refreshStats();
}

async function unloadModel() {
  const result = await window.nexa.engine.unload();
  if (result.ok) toast('Modelo liberado de RAM/VRAM.', 'success');
  else toast(result.error || 'No se pudo liberar el modelo.', 'error');
  setTimeout(refreshStats, 700);
}

function resizePrompt() {
  els.promptInput.style.height = 'auto';
  els.promptInput.style.height = `${Math.min(180, Math.max(28, els.promptInput.scrollHeight))}px`;
}

function cacheElements() {
  const ids = [
    'newChatBtn','chatSearch','chatList','chatTitle','engineDot','engineText','modelText','fastModeBtn','lightModeBtn',
    'welcomeState','welcomeStartEngine','welcomeWarmModel','messages','generationBanner','stopBtn','promptInput','sendBtn','composerHint',
    'inspectorTitle','inspectorSubtitle','refreshBtn','ollamaBadge','startEngineBtn','warmModelBtn','unloadModelBtn','ramLabel','ramBar','aiRam','unityRam',
    'vramLabel','vramBar','aiVram','otherVram','gpuUsage','gpuTemp','profileBadge','profileDescription','unityBadge','unityAdvice',
    'memoryForm','memoryInput','memoryCount','includeMemories','memoryList','settingsForm','settingModel','settingBaseUrl','settingOllamaExe','settingModelsPath',
    'settingContext','settingLightLayers','settingKeepAlive','settingAutoUnity','openDataBtn','versionLabel','toastHost'
  ];
  for (const id of ids) els[id] = document.getElementById(id);
}

function bindEvents() {
  els.newChatBtn.addEventListener('click', () => {
    const chat = { id: uid('chat'), title:'Nuevo chat', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), messages:[] };
    state.chats.unshift(chat); state.currentChatId = chat.id; renderChats(); renderCurrentChat(); els.promptInput.focus();
  });
  els.chatSearch.addEventListener('input', renderChats);
  els.chatList.addEventListener('click', async event => {
    const deleteButton = event.target.closest('[data-delete-chat]');
    if (deleteButton) {
      event.stopPropagation();
      const chatId = deleteButton.dataset.deleteChat;
      if (!confirm('¿Eliminar esta conversación?')) return;
      await window.nexa.store.deleteChat(chatId);
      state.chats = state.chats.filter(chat => chat.id !== chatId);
      if (state.currentChatId === chatId) state.currentChatId = state.chats[0]?.id || null;
      renderChats(); renderCurrentChat();
      return;
    }
    const item = event.target.closest('[data-chat-id]');
    if (!item) return;
    state.currentChatId = item.dataset.chatId; renderChats(); renderCurrentChat();
  });
  els.chatTitle.addEventListener('change', async () => {
    const chat = currentChat(); if (!chat) return;
    chat.title = els.chatTitle.value.trim() || 'Nuevo chat'; await persistChat(chat);
  });
  els.fastModeBtn.addEventListener('click', () => selectMode('fast'));
  els.lightModeBtn.addEventListener('click', () => selectMode('light'));
  els.sendBtn.addEventListener('click', sendMessage);
  els.stopBtn.addEventListener('click', stopGeneration);
  els.promptInput.addEventListener('input', resizePrompt);
  els.promptInput.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); }
  });
  document.addEventListener('keydown', event => {
    if (event.ctrlKey && event.key.toLowerCase() === 'n') { event.preventDefault(); els.newChatBtn.click(); }
  });
  document.querySelectorAll('.nav-button').forEach(button => button.addEventListener('click', () => showPanel(button.dataset.panel)));
  els.refreshBtn.addEventListener('click', refreshStats);
  els.startEngineBtn.addEventListener('click', startEngine);
  els.welcomeStartEngine.addEventListener('click', startEngine);
  els.warmModelBtn.addEventListener('click', warmModel);
  els.welcomeWarmModel.addEventListener('click', warmModel);
  els.unloadModelBtn.addEventListener('click', unloadModel);
  els.memoryForm.addEventListener('submit', async event => {
    event.preventDefault();
    await saveMemory(els.memoryInput.value); els.memoryInput.value = '';
  });
  els.includeMemories.addEventListener('change', async () => {
    state.settings.includeMemories = els.includeMemories.checked;
    await window.nexa.store.saveSettings({ includeMemories: state.settings.includeMemories });
  });
  els.memoryList.addEventListener('change', async event => {
    const toggle = event.target.closest('[data-toggle-memory]'); if (!toggle) return;
    const memory = state.memories.find(item => item.id === toggle.dataset.toggleMemory); if (!memory) return;
    memory.enabled = toggle.checked;
    const saved = await window.nexa.store.saveMemory(memory);
    Object.assign(memory, saved); renderMemories();
  });
  els.memoryList.addEventListener('click', async event => {
    const button = event.target.closest('[data-delete-memory]'); if (!button) return;
    await window.nexa.store.deleteMemory(button.dataset.deleteMemory);
    state.memories = state.memories.filter(memory => memory.id !== button.dataset.deleteMemory); renderMemories();
  });
  els.messages.addEventListener('click', async event => {
    const memoryButton = event.target.closest('[data-memory-message]');
    const copyButton = event.target.closest('[data-copy-message]');
    const chat = currentChat(); if (!chat) return;
    if (memoryButton) {
      const message = chat.messages.find(item => item.id === memoryButton.dataset.memoryMessage);
      if (message) await saveMemory(message.content);
    }
    if (copyButton) {
      const message = chat.messages.find(item => item.id === copyButton.dataset.copyMessage);
      if (message) { await navigator.clipboard.writeText(message.content); toast('Copiado.'); }
    }
  });
  els.settingsForm.addEventListener('submit', saveSettings);
  els.openDataBtn.addEventListener('click', () => window.nexa.system.openDataFolder());
  window.nexa.chat.onToken(packet => {
    if (packet.requestId !== state.activeRequestId) return;
    updateStreamingMessage(packet.content || '');
  });
  window.nexa.chat.onDone(packet => {
    if (packet.requestId !== state.activeRequestId) return;
    finishGeneration(packet.stats).catch(error => finishWithError(error.message));
  });
  window.nexa.chat.onError(packet => {
    if (packet.requestId !== state.activeRequestId) return;
    finishWithError(packet.error || 'Error de generación.');
  });
}

async function init() {
  cacheElements();
  bindEvents();
  const snapshot = await window.nexa.store.get();
  state.settings = snapshot.settings || {};
  state.chats = snapshot.chats || [];
  state.memories = snapshot.memories || [];
  state.currentChatId = state.chats[0]?.id || null;
  els.versionLabel.textContent = `v${snapshot.appVersion || '1.0.0'}`;
  fillSettings();
  updateModeUi();
  renderChats();
  renderMemories();
  renderCurrentChat();
  resizePrompt();
  await refreshStats();
  state.statsTimer = setInterval(refreshStats, 2500);
}

init().catch(error => {
  console.error(error);
  document.body.innerHTML = `<pre style="padding:24px;color:#ff9aa5">Nexa AI no pudo iniciar:\n${escapeHtml(error.stack || error.message || String(error))}</pre>`;
});
