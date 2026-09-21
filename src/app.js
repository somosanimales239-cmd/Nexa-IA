'use strict';

const state = {
  settings: {},
  chats: [],
  memories: [],
  libraries: [],
  knowledgeRoot: '',
  currentChatId: null,
  activeRequestId: null,
  activeAssistantMessageId: null,
  statsTimer: null,
  lastUnityDetected: false,
  autoModeBusy: false,
  userPinnedToBottom: true,
};

const $ = selector => document.querySelector(selector);
const els = {};

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function escapeHtml(value) {
  const source = String(value ?? '');
  const replacements = { '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' };
  let output = '';
  for (const char of source) output += replacements[char] || char;
  return output;
}

function normalizeWhitespace(value) {
  const source = String(value ?? '');
  let output = '';
  let pendingSpace = false;
  for (const char of source) {
    const isWhitespace = char === ' ' || char === '\t' || char === '\r' || char === '\n' || char === '\f' || char === '\v';
    if (isWhitespace) {
      if (output.length) pendingSpace = true;
      continue;
    }
    if (pendingSpace) output += ' ';
    output += char;
    pendingSpace = false;
  }
  return output.trim();
}

function formatTime(iso) {
  try { return new Intl.DateTimeFormat('es', { hour:'2-digit', minute:'2-digit' }).format(new Date(iso)); }
  catch (_) { return ''; }
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
  const n = Number(bytes || 0);
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(n >= 10 * 1024 ** 3 ? 1 : 2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(n / 1024))} KB`;
}

function mbLabel(mb) {
  return Number(mb || 0) >= 1024 ? `${(Number(mb) / 1024).toFixed(2)} GB` : `${Math.round(Number(mb || 0))} MB`;
}

function toast(message, type = '') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  els.toastHost.appendChild(node);
  setTimeout(() => node.remove(), 3800);
}

function currentChat() {
  return state.chats.find(chat => chat.id === state.currentChatId) || null;
}

function ensureChat() {
  let chat = currentChat();
  if (chat) return chat;
  chat = {
    id: uid('chat'), title: 'Nuevo chat', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    libraryIds: [], messages: [],
  };
  state.chats.unshift(chat);
  state.currentChatId = chat.id;
  renderChats(); renderCurrentChat(); renderLibraries();
  return chat;
}

async function persistChat(chat) {
  const saved = await window.nexa.store.saveChat(chat);
  const index = state.chats.findIndex(item => item.id === saved.id);
  if (index >= 0) state.chats[index] = saved;
  else state.chats.unshift(saved);
  state.chats.sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  renderChats();
}

function autoTitle(chat) {
  if (!chat || chat.title !== 'Nuevo chat') return;
  const firstUser = chat.messages.find(message => message.role === 'user');
  if (!firstUser) return;
  const compact = normalizeWhitespace(firstUser.content);
  chat.title = compact.slice(0,58) || 'Nuevo chat';
  if (compact.length > 58) chat.title += '…';
  els.chatTitle.value = chat.title;
}

function renderChats() {
  const query = els.chatSearch.value.trim().toLowerCase();
  const chats = state.chats.slice().sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .filter(chat => !query || chat.title.toLowerCase().includes(query) || chat.messages.some(m => String(m.content || '').toLowerCase().includes(query)));
  if (!chats.length) {
    els.chatList.innerHTML = `<div class="empty-list">${query ? 'No hay coincidencias.' : 'Todavía no hay conversaciones.'}</div>`;
    return;
  }
  els.chatList.innerHTML = chats.map(chat => `
    <div class="chat-item ${chat.id === state.currentChatId ? 'active' : ''}" data-chat-id="${escapeHtml(chat.id)}">
      <div><div class="chat-item-title">${escapeHtml(chat.title)}</div><div class="chat-item-time">${relativeTime(chat.updatedAt)}</div></div>
      <button class="chat-delete" data-delete-chat="${escapeHtml(chat.id)}" title="Eliminar">×</button>
    </div>`).join('');
}


function isNearBottom() {
  if (!els.messages || els.messages.hidden) return true;
  const threshold = 120;
  const remaining = els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight;
  return remaining <= threshold;
}

function updateScrollUi() {
  if (!els.messages || els.messages.hidden) {
    if (els.jumpToBottomBtn) els.jumpToBottomBtn.hidden = true;
    state.userPinnedToBottom = true;
    return;
  }
  const nearBottom = isNearBottom();
  state.userPinnedToBottom = nearBottom;
  if (els.jumpToBottomBtn) els.jumpToBottomBtn.hidden = nearBottom;
}

function scrollMessagesToBottom(force = false) {
  if (!els.messages || els.messages.hidden) return;
  if (!force && !state.userPinnedToBottom) {
    updateScrollUi();
    return;
  }
  requestAnimationFrame(() => {
    els.messages.scrollTop = els.messages.scrollHeight;
    updateScrollUi();
  });
}

function sourceChips(message) {
  if (!Array.isArray(message.sources) || !message.sources.length) return '';
  var chips = message.sources.map(function (source) {
    var page = source.page ? ' p.' + source.page : '';
    return '<span class="source-chip" title="' + escapeHtml(source.path || '') + '">▣ ' +
      escapeHtml(source.documentName || source.libraryName || 'Fuente') + page + '</span>';
  }).join('');
  return '<div class="source-row">' + chips + '</div>';
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
        <div class="message-head"><span class="message-author">${message.role === 'assistant' ? 'Nexa AI' : 'Tú'}</span><span class="message-time">${formatTime(message.createdAt)}</span></div>
        <div class="message-content">${escapeHtml(message.content)}</div>
        ${sourceChips(message)}
        <div class="message-actions">
          <button class="message-action" data-memory-message="${escapeHtml(message.id)}">Guardar en memoria</button>
          <button class="message-action" data-copy-message="${escapeHtml(message.id)}">Copiar</button>
        </div>
      </div>
    </article>`).join('');
  scrollMessagesToBottom(true);
  updateScrollUi();
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
  scrollMessagesToBottom();
}

function attachSources(sources) {
  const chat = currentChat();
  const message = chat?.messages.find(item => item.id === state.activeAssistantMessageId);
  if (!message) return;
  message.sources = Array.isArray(sources) ? sources : [];
  renderCurrentChat();
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
  chat.messages.push({ id:uid('msg'), role:'user', content:text, createdAt:now, sources:[] });
  autoTitle(chat);
  chat.messages.push({ id:uid('msg'), role:'assistant', content:'', createdAt:new Date().toISOString(), sources:[] });
  state.activeAssistantMessageId = chat.messages[chat.messages.length - 1].id;
  els.promptInput.value = '';
  resizePrompt(); renderCurrentChat();
  await persistChat(chat);

  const requestId = uid('req');
  state.activeRequestId = requestId;
  setGenerating(true);
  try {
    const result = await window.nexa.chat.start({
      requestId,
      libraryIds: Array.isArray(chat.libraryIds) ? chat.libraryIds : [],
      messages: chat.messages.filter(message => message.id !== state.activeAssistantMessageId).map(message => ({ role:message.role, content:message.content })),
    });
    if (!result?.ok) throw new Error(result?.error || 'No se pudo iniciar la respuesta.');
    if (Array.isArray(result.sources) && result.sources.length) attachSources(result.sources);
  } catch (error) { finishWithError(error.message || String(error)); }
}

async function finishGeneration(stats) {
  const chat = currentChat();
  const message = chat?.messages.find(item => item.id === state.activeAssistantMessageId);
  if (message && !message.content.trim()) message.content = '(La respuesta terminó sin contenido.)';
  if (chat) await persistChat(chat);
  state.activeRequestId = null;
  state.activeAssistantMessageId = null;
  setGenerating(false); renderCurrentChat();
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
  state.activeRequestId = null; state.activeAssistantMessageId = null;
  setGenerating(false); renderCurrentChat(); toast(message,'error');
}

async function stopGeneration() {
  if (!state.activeRequestId) return;
  await window.nexa.chat.stop(state.activeRequestId);
  await finishGeneration();
}

async function selectMode(mode, { silent=false } = {}) {
  if (!['fast','light'].includes(mode) || mode === state.settings.profile) return;
  state.settings.profile = mode; updateModeUi();
  await window.nexa.store.saveSettings({ profile:mode });
  const unload = await window.nexa.engine.unload();
  if (!silent) toast(mode === 'fast'
    ? 'Modo Rápido activado. El modelo se recargará usando la selección automática de GPU.'
    : `Modo Ligero activado. El modelo se recargará con ${state.settings.lightGpuLayers} capas en GPU.`, unload.ok ? 'success' : '');
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
      <div class="memory-actions">
        <label class="toggle-row compact"><input type="checkbox" data-toggle-memory="${escapeHtml(memory.id)}" ${memory.enabled !== false ? 'checked' : ''}/><span>Activa</span></label>
        <button class="tiny danger" data-delete-memory="${escapeHtml(memory.id)}">Eliminar</button>
      </div>
    </div>`).join('');
}

async function saveMemory(text) {
  const clean = String(text || '').trim();
  if (!clean) return;
  const saved = await window.nexa.store.saveMemory({ text:clean, enabled:true });
  state.memories.unshift(saved); renderMemories(); toast('Memoria guardada localmente.','success');
}

function enabledLibrariesForChat(chat = currentChat()) {
  const enabled = state.libraries.filter(lib => lib.enabled !== false);
  if (!chat || !Array.isArray(chat.libraryIds) || chat.libraryIds.length === 0) return enabled.map(lib => lib.id);
  return chat.libraryIds.filter(id => enabled.some(lib => lib.id === id));
}

function renderLibraries() {
  const libs = state.libraries || [];
  const totalDocs = libs.reduce((sum,lib) => sum + (lib.documents?.length || 0),0);
  const totalChunks = libs.reduce((sum,lib) => sum + Number(lib.chunkCount || 0),0);
  els.knowledgeCount.textContent = libs.length + ' ' + (libs.length === 1 ? 'librería' : 'librerías') + ' • ' + totalDocs + ' docs • ' + totalChunks + ' fragmentos';
  els.includeKnowledge.checked = state.settings.includeKnowledge !== false;
  els.knowledgeTopStatus.textContent = libs.length ? (libs.length + ' librerías • ' + totalChunks + ' chunks') : 'Knowledge local';
  if (!libs.length) {
    els.libraryList.innerHTML = '<div class="empty-list">Crea tu primera Knowledge Library y agrega un libro, manual o carpeta.</div>';
    return;
  }
  const chat = currentChat();
  const implicitAll = !chat || !Array.isArray(chat.libraryIds) || chat.libraryIds.length === 0;
  els.libraryList.innerHTML = libs.map(function (lib) {
    const selected = lib.enabled !== false && (implicitAll || chat.libraryIds.includes(lib.id));
    const docs = Array.isArray(lib.documents) ? lib.documents : [];
    const docRows = docs.slice(-5).reverse().map(function (doc) {
      const pageText = doc.pageCount ? (' • ' + doc.pageCount + ' pág.') : '';
      return '<div class="library-doc">' +
        '<div><strong>' + escapeHtml(doc.name) + '</strong><small>' + escapeHtml(doc.extension || '') +
        ' • ' + bytesLabel(doc.sizeBytes) + ' • ' + (doc.chunkCount || 0) + ' chunks' + pageText + '</small></div>' +
        '<button class="doc-remove" data-remove-doc="' + escapeHtml(doc.id) + '" data-library-id="' + escapeHtml(lib.id) + '" title="Quitar">×</button>' +
        '</div>';
    }).join('');
    const docsBlock = docRows ? ('<div class="library-docs">' + docRows + '</div>') : '<div class="library-empty">Todavía no tiene documentos.</div>';
    return '<article class="library-card" data-library-id="' + escapeHtml(lib.id) + '">' +
      '<div class="library-head">' +
        '<div><strong>' + escapeHtml(lib.name) + '</strong><small>' + escapeHtml(lib.category || 'General') + ' • ' + docs.length + ' docs • ' + (lib.chunkCount || 0) + ' chunks</small></div>' +
        '<label class="toggle-row compact"><input type="checkbox" data-lib-enabled="' + escapeHtml(lib.id) + '" ' + (lib.enabled !== false ? 'checked' : '') + '/><span>Activa</span></label>' +
      '</div>' +
      '<label class="chat-library-toggle"><input type="checkbox" data-lib-chat="' + escapeHtml(lib.id) + '" ' + (selected ? 'checked' : '') + ' ' + (lib.enabled === false ? 'disabled' : '') + '/><span>Usar en este chat</span></label>' +
      docsBlock +
      '<div class="library-actions">' +
        '<button class="secondary tiny" data-lib-files="' + escapeHtml(lib.id) + '">+ Archivos</button>' +
        '<button class="secondary tiny" data-lib-folder="' + escapeHtml(lib.id) + '">+ Carpeta</button>' +
        '<button class="secondary tiny" data-lib-open="' + escapeHtml(lib.id) + '">Abrir</button>' +
        '<button class="tiny danger" data-lib-delete="' + escapeHtml(lib.id) + '">Eliminar</button>' +
      '</div>' +
      '</article>';
  }).join('');
}

async function importIntoLibrary(libraryId, type) {
  const files = type === 'folder' ? await window.nexa.knowledge.chooseFolder() : await window.nexa.knowledge.chooseFiles();
  if (!files?.length) return;
  toast(`Indexando ${files.length} archivo${files.length === 1 ? '' : 's'}…`);
  els.knowledgeProgress.hidden = false;
  const result = await window.nexa.knowledge.addFiles(libraryId, files);
  await refreshLibraries();
  const ok = result?.results?.filter(item => item.ok).length || 0;
  const failed = result?.results?.filter(item => !item.ok).length || 0;
  toast(`${ok} archivo(s) indexado(s)${failed ? ` • ${failed} con error` : ''}.`, failed ? '' : 'success');
  setTimeout(() => { els.knowledgeProgress.hidden = true; }, 1200);
}

async function runKnowledgeSearch() {
  const query = els.knowledgeSearchInput.value.trim();
  if (!query) return;
  const libraryIds = enabledLibrariesForChat();
  const results = await window.nexa.knowledge.search(query, { libraryIds, limit:8 });
  if (!results.length) {
    els.knowledgeSearchResults.innerHTML = '<div class="empty-list">No encontré coincidencias en las librerías activas.</div>';
    return;
  }
  els.knowledgeSearchResults.innerHTML = results.map(function (result) {
    const pageText = result.page ? (' • pág. ' + result.page) : '';
    const rawText = String(result.text || '');
    const preview = escapeHtml(rawText.slice(0,260)) + (rawText.length > 260 ? '…' : '');
    return '<div class="knowledge-hit">' +
      '<strong>' + escapeHtml(result.documentName) + pageText + '</strong>' +
      '<small>' + escapeHtml(result.libraryName) + ' • score ' + result.score + '</small>' +
      '<p>' + preview + '</p>' +
      '</div>';
  }).join('');
}

function showPanel(name) {
  document.querySelectorAll('.nav-button').forEach(button => button.classList.toggle('active', button.dataset.panel === name));
  document.querySelectorAll('[data-panel-view]').forEach(panel => panel.classList.toggle('active', panel.dataset.panelView === name));
  const meta = {
    system:['Sistema','Estado local en tiempo real'],
    memory:['Memoria','Recuerdos persistentes independientes del modelo'],
    knowledge:['Knowledge Libraries','Libros y documentación local reutilizable'],
    settings:['Ajustes','Modelo, rendimiento y rutas locales'],
  }[name] || ['Nexa AI',''];
  els.inspectorTitle.textContent = meta[0]; els.inspectorSubtitle.textContent = meta[1];
}

function fillSettings() {
  els.settingModel.value = state.settings.model || 'gpt-oss:20b';
  els.settingBaseUrl.value = state.settings.baseUrl || 'http://127.0.0.1:11434';
  els.settingOllamaExe.value = state.settings.ollamaExe || '';
  els.settingModelsPath.value = state.settings.modelsPath || '';
  els.settingContext.value = state.settings.contextLength || 4096;
  els.settingLightLayers.value = state.settings.lightGpuLayers ?? 6;
  els.settingKeepAlive.value = state.settings.keepAlive || '5m';
  els.settingAutoUnity.checked = Boolean(state.settings.autoUnityMode);
  els.settingKnowledgeChunks.value = state.settings.knowledgeMaxChunks || 6;
  els.settingKnowledgeChars.value = state.settings.knowledgeMaxChars || 7500;
  els.includeKnowledge.checked = state.settings.includeKnowledge !== false;
}

async function saveSettings(event) {
  event.preventDefault();
  const patch = {
    model: els.settingModel.value.trim() || 'gpt-oss:20b',
    baseUrl: els.settingBaseUrl.value.trim() || 'http://127.0.0.1:11434',
    ollamaExe: els.settingOllamaExe.value.trim(), modelsPath: els.settingModelsPath.value.trim(),
    contextLength: Number(els.settingContext.value) || 4096,
    lightGpuLayers: Number(els.settingLightLayers.value) || 0,
    keepAlive: els.settingKeepAlive.value.trim() || '5m',
    autoUnityMode: els.settingAutoUnity.checked,
    knowledgeMaxChunks: Number(els.settingKnowledgeChunks.value) || 6,
    knowledgeMaxChars: Number(els.settingKnowledgeChars.value) || 7500,
  };
  state.settings = { ...state.settings, ...(await window.nexa.store.saveSettings(patch)) };
  updateModeUi(); fillSettings(); toast('Ajustes guardados.','success'); refreshStats();
}

function setBar(element, value, total) {
  const percent = total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;
  element.style.width = `${percent}%`;
}

async function maybeAutoUnity(stats) {
  if (!state.settings.autoUnityMode || state.autoModeBusy) { state.lastUnityDetected = Boolean(stats.unityDetected); return; }
  const detected = Boolean(stats.unityDetected);
  if (detected === state.lastUnityDetected) return;
  state.lastUnityDetected = detected; state.autoModeBusy = true;
  try {
    if (detected && state.settings.profile !== 'light') await selectMode('light', { silent:true });
    if (!detected && state.settings.profile !== 'fast') await selectMode('fast', { silent:true });
  } finally { state.autoModeBusy = false; }
}

async function refreshStats() {
  try {
    const stats = await window.nexa.system.stats();
    const online = Boolean(stats.ollama?.online);
    els.engineDot.className = `status-dot ${online ? 'online' : 'offline'}`;
    els.engineText.textContent = online ? 'Ollama local conectado' : 'Ollama desconectado';
    els.ollamaBadge.textContent = online ? (stats.ollama.selectedRunning ? 'Modelo cargado' : 'Online') : 'Offline';
    els.ollamaBadge.className = `badge ${online ? 'lime' : 'red'}`;
    els.modelText.textContent = state.settings.model;

    const ram = stats.ram || {};
    els.ramLabel.textContent = `${ram.usedGb ?? '—'} / ${ram.totalGb ?? '—'} GB`;
    els.aiRam.textContent = `${ram.aiGb ?? 0} GB`; els.unityRam.textContent = `${ram.unityGb ?? 0} GB`;
    setBar(els.ramBar, Number(ram.usedGb || 0), Number(ram.totalGb || 0));

    const gpu = stats.gpu || {};
    if (gpu.available) {
      els.vramLabel.textContent = `${mbLabel(gpu.memoryUsedMb)} / ${mbLabel(gpu.memoryTotalMb)}`;
      els.aiVram.textContent = mbLabel(gpu.aiVramMb); els.otherVram.textContent = mbLabel(gpu.otherVramMb);
      els.gpuUsage.textContent = `${gpu.utilization || 0}%`; els.gpuTemp.textContent = `${gpu.temperature || 0} °C`;
      setBar(els.vramBar, Number(gpu.memoryUsedMb || 0), Number(gpu.memoryTotalMb || 0));
    } else {
      els.vramLabel.textContent = 'No disponible'; els.aiVram.textContent='—'; els.otherVram.textContent='—'; els.gpuUsage.textContent='—'; els.gpuTemp.textContent='—'; setBar(els.vramBar,0,1);
    }
    els.unityBadge.textContent = stats.unityDetected ? 'Detectado' : 'No detectado';
    els.unityBadge.className = `badge ${stats.unityDetected ? 'blue' : 'muted'}`;
    els.unityAdvice.textContent = stats.unityDetected
      ? `Unity está usando ${ram.unityGb || 0} GB de RAM. ${state.settings.profile === 'light' ? 'Modo Ligero está activo.' : 'Puedes activar Ligero para liberar VRAM.'}`
      : 'Cuando Unity esté abierto, el modo Ligero deja más VRAM disponible.';
    await maybeAutoUnity(stats);
  } catch (_) {
    els.engineDot.className = 'status-dot offline'; els.engineText.textContent = 'Estado no disponible';
  }
}

async function startEngine() {
  toast('Iniciando Ollama…');
  const result = await window.nexa.engine.start();
  if (result.ok) toast(result.alreadyRunning ? 'Ollama ya estaba funcionando.' : 'Ollama iniciado.','success');
  else toast(result.error || 'No se pudo iniciar Ollama.','error');
  refreshStats();
}

async function warmModel() {
  toast(`Cargando ${state.settings.model}… puede tardar en el disco externo.`);
  const result = await window.nexa.engine.warm();
  if (result.ok) toast('Modelo cargado y listo.','success');
  else toast(result.error || 'No se pudo cargar el modelo.','error');
  refreshStats();
}

async function unloadModel() {
  const result = await window.nexa.engine.unload();
  if (result.ok) toast('Modelo liberado de RAM/VRAM.','success');
  else toast(result.error || 'No se pudo liberar el modelo.','error');
  setTimeout(refreshStats,700);
}

function resizePrompt() {
  els.promptInput.style.height = 'auto';
  els.promptInput.style.height = `${Math.min(180,Math.max(28,els.promptInput.scrollHeight))}px`;
}

function cacheElements() {
  const ids = [
    'newChatBtn','chatSearch','chatList','chatTitle','engineDot','engineText','modelText','knowledgeTopStatus','fastModeBtn','lightModeBtn',
    'welcomeState','welcomeStartEngine','welcomeWarmModel','messages','jumpToBottomBtn','generationBanner','stopBtn','promptInput','sendBtn','composerHint',
    'inspectorTitle','inspectorSubtitle','refreshBtn','ollamaBadge','startEngineBtn','warmModelBtn','unloadModelBtn','ramLabel','ramBar','aiRam','unityRam',
    'vramLabel','vramBar','aiVram','otherVram','gpuUsage','gpuTemp','profileBadge','profileDescription','unityBadge','unityAdvice',
    'memoryForm','memoryInput','memoryCount','includeMemories','memoryList',
    'libraryForm','libraryName','libraryCategory','knowledgeProgress','knowledgeProgressText','knowledgeProgressPct','knowledgeProgressBar','knowledgeCount','includeKnowledge','libraryList',
    'knowledgeSearchInput','knowledgeSearchBtn','knowledgeSearchResults','openKnowledgeBtn',
    'settingsForm','settingModel','settingBaseUrl','settingOllamaExe','settingModelsPath','settingContext','settingLightLayers','settingKeepAlive','settingAutoUnity',
    'settingKnowledgeChunks','settingKnowledgeChars','openDataBtn','versionLabel','toastHost',
  ];
  for (const id of ids) els[id] = document.getElementById(id);
}

function bindEvents() {
  els.newChatBtn.addEventListener('click', () => {
    const chat = { id:uid('chat'), title:'Nuevo chat', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), libraryIds:[], messages:[] };
    state.chats.unshift(chat); state.currentChatId = chat.id; renderChats(); renderCurrentChat(); renderLibraries(); els.promptInput.focus();
  });
  els.chatSearch.addEventListener('input', renderChats);
  els.chatList.addEventListener('click', async event => {
    const deleteButton = event.target.closest('[data-delete-chat]');
    if (deleteButton) {
      event.stopPropagation(); const chatId = deleteButton.dataset.deleteChat;
      if (!confirm('¿Eliminar esta conversación?')) return;
      await window.nexa.store.deleteChat(chatId); state.chats = state.chats.filter(chat => chat.id !== chatId);
      if (state.currentChatId === chatId) state.currentChatId = state.chats[0]?.id || null;
      renderChats(); renderCurrentChat(); renderLibraries(); return;
    }
    const item = event.target.closest('[data-chat-id]'); if (!item) return;
    state.currentChatId = item.dataset.chatId; renderChats(); renderCurrentChat(); renderLibraries();
  });
  els.chatTitle.addEventListener('change', async () => {
    const chat = currentChat(); if (!chat) return;
    chat.title = els.chatTitle.value.trim() || 'Nuevo chat'; await persistChat(chat);
  });
  els.fastModeBtn.addEventListener('click', () => selectMode('fast'));
  els.lightModeBtn.addEventListener('click', () => selectMode('light'));
  els.sendBtn.addEventListener('click', sendMessage); els.stopBtn.addEventListener('click', stopGeneration);
  els.promptInput.addEventListener('input', resizePrompt);
  els.messages.addEventListener('scroll', updateScrollUi);
  els.jumpToBottomBtn.addEventListener('click', () => scrollMessagesToBottom(true));
  els.promptInput.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } });
  document.addEventListener('keydown', event => { if (event.ctrlKey && event.key.toLowerCase() === 'n') { event.preventDefault(); els.newChatBtn.click(); } });
  document.querySelectorAll('.nav-button').forEach(button => button.addEventListener('click', () => showPanel(button.dataset.panel)));
  els.refreshBtn.addEventListener('click', refreshStats);
  els.startEngineBtn.addEventListener('click', startEngine); els.welcomeStartEngine.addEventListener('click', startEngine);
  els.warmModelBtn.addEventListener('click', warmModel); els.welcomeWarmModel.addEventListener('click', warmModel);
  els.unloadModelBtn.addEventListener('click', unloadModel);

  els.memoryForm.addEventListener('submit', async event => { event.preventDefault(); await saveMemory(els.memoryInput.value); els.memoryInput.value=''; });
  els.includeMemories.addEventListener('change', async () => {
    state.settings.includeMemories = els.includeMemories.checked;
    await window.nexa.store.saveSettings({ includeMemories:state.settings.includeMemories });
  });
  els.memoryList.addEventListener('change', async event => {
    const toggle = event.target.closest('[data-toggle-memory]'); if (!toggle) return;
    const memory = state.memories.find(item => item.id === toggle.dataset.toggleMemory); if (!memory) return;
    memory.enabled = toggle.checked; Object.assign(memory, await window.nexa.store.saveMemory(memory)); renderMemories();
  });
  els.memoryList.addEventListener('click', async event => {
    const button = event.target.closest('[data-delete-memory]'); if (!button) return;
    await window.nexa.store.deleteMemory(button.dataset.deleteMemory);
    state.memories = state.memories.filter(memory => memory.id !== button.dataset.deleteMemory); renderMemories();
  });
  els.messages.addEventListener('click', async event => {
    const memoryButton = event.target.closest('[data-memory-message]'); const copyButton = event.target.closest('[data-copy-message]');
    const chat = currentChat(); if (!chat) return;
    if (memoryButton) { const message = chat.messages.find(item => item.id === memoryButton.dataset.memoryMessage); if (message) await saveMemory(message.content); }
    if (copyButton) { const message = chat.messages.find(item => item.id === copyButton.dataset.copyMessage); if (message) { await navigator.clipboard.writeText(message.content); toast('Copiado.'); } }
  });

  els.libraryForm.addEventListener('submit', async event => {
    event.preventDefault();
    const name = els.libraryName.value.trim(); if (!name) return toast('Escribe un nombre para la librería.','error');
    await window.nexa.knowledge.create({ name, category:els.libraryCategory.value.trim() || 'General', copyOriginals:true });
    els.libraryName.value=''; els.libraryCategory.value=''; await refreshLibraries(); toast('Knowledge Library creada.','success');
  });
  els.includeKnowledge.addEventListener('change', async () => {
    state.settings.includeKnowledge = els.includeKnowledge.checked;
    await window.nexa.store.saveSettings({ includeKnowledge:state.settings.includeKnowledge });
  });
  els.libraryList.addEventListener('change', async event => {
    const enabled = event.target.closest('[data-lib-enabled]');
    if (enabled) {
      await window.nexa.knowledge.update(enabled.dataset.libEnabled, { enabled:enabled.checked });
      await refreshLibraries(); return;
    }
    const chatToggle = event.target.closest('[data-lib-chat]');
    if (chatToggle) {
      const chat = ensureChat();
      const enabledIds = state.libraries.filter(lib => lib.enabled !== false).map(lib => lib.id);
      let explicit = (!Array.isArray(chat.libraryIds) || chat.libraryIds.length === 0) ? enabledIds.slice() : chat.libraryIds.slice();
      if (chatToggle.checked) { if (!explicit.includes(chatToggle.dataset.libChat)) explicit.push(chatToggle.dataset.libChat); }
      else explicit = explicit.filter(id => id !== chatToggle.dataset.libChat);
      chat.libraryIds = explicit;
      await persistChat(chat); renderLibraries();
    }
  });
  els.libraryList.addEventListener('click', async event => {
    const files = event.target.closest('[data-lib-files]'); if (files) return importIntoLibrary(files.dataset.libFiles,'files');
    const folder = event.target.closest('[data-lib-folder]'); if (folder) return importIntoLibrary(folder.dataset.libFolder,'folder');
    const open = event.target.closest('[data-lib-open]'); if (open) return window.nexa.knowledge.openLibrary(open.dataset.libOpen);
    const del = event.target.closest('[data-lib-delete]');
    if (del) {
      if (!confirm('¿Eliminar esta Knowledge Library y sus copias/index local?')) return;
      await window.nexa.knowledge.delete(del.dataset.libDelete); await refreshLibraries(); toast('Librería eliminada.'); return;
    }
    const doc = event.target.closest('[data-remove-doc]');
    if (doc) {
      if (!confirm('¿Quitar este documento del conocimiento de Nexa?')) return;
      await window.nexa.knowledge.removeDocument(doc.dataset.libraryId, doc.dataset.removeDoc); await refreshLibraries(); toast('Documento retirado.');
    }
  });
  els.knowledgeSearchBtn.addEventListener('click', runKnowledgeSearch);
  els.knowledgeSearchInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); runKnowledgeSearch(); } });
  els.openKnowledgeBtn.addEventListener('click', () => window.nexa.knowledge.openRoot());

  els.settingsForm.addEventListener('submit', saveSettings);
  els.openDataBtn.addEventListener('click', () => window.nexa.system.openDataFolder());

  window.nexa.chat.onToken(packet => { if (packet.requestId === state.activeRequestId) updateStreamingMessage(packet.content || ''); });
  window.nexa.chat.onContext(packet => { if (packet.requestId === state.activeRequestId) attachSources(packet.sources || []); });
  window.nexa.chat.onDone(packet => { if (packet.requestId === state.activeRequestId) finishGeneration(packet.stats).catch(error => finishWithError(error.message)); });
  window.nexa.chat.onError(packet => { if (packet.requestId === state.activeRequestId) finishWithError(packet.error || 'Error de generación.'); });
  window.nexa.knowledge.onProgress(packet => {
    els.knowledgeProgress.hidden = false;
    if (packet.phase === 'done') {
      els.knowledgeProgressText.textContent = 'Indexación terminada'; els.knowledgeProgressPct.textContent = '100%'; setBar(els.knowledgeProgressBar,1,1); return;
    }
    const current = Number(packet.current || 0), total = Math.max(1,Number(packet.total || 1));
    els.knowledgeProgressText.textContent = packet.phase === 'pdf' ? `Leyendo PDF: ${packet.file || ''}` : `Indexando: ${packet.file || ''}`;
    els.knowledgeProgressPct.textContent = `${Math.round((current/total)*100)}%`; setBar(els.knowledgeProgressBar,current,total);
  });
}

async function init() {
  cacheElements(); bindEvents();
  const [snapshot, knowledge] = await Promise.all([window.nexa.store.get(), window.nexa.knowledge.list()]);
  state.settings = snapshot.settings || {}; state.chats = snapshot.chats || []; state.memories = snapshot.memories || [];
  state.libraries = knowledge?.libraries || []; state.knowledgeRoot = knowledge?.root || snapshot.knowledgeDirectory || '';
  state.currentChatId = state.chats[0]?.id || null;
  els.versionLabel.textContent = `v${snapshot.appVersion || '1.2.4'}`;
  fillSettings(); updateModeUi(); renderChats(); renderMemories(); renderLibraries(); renderCurrentChat(); resizePrompt(); updateScrollUi();
  await refreshStats(); state.statsTimer = setInterval(refreshStats,2500);
}

init().catch(error => {
  console.error(error);
  document.body.innerHTML = `<pre style="padding:24px;color:#ff9aa5">Nexa AI no pudo iniciar:\n${escapeHtml(error.stack || error.message || String(error))}</pre>`;
});
