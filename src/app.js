'use strict';

const state = {
  settings: {},
  chats: [],
  memories: [],
  libraries: [],
  objectives: [],
  knowledgeDbStats: null,
  bridgeStatus: null,
  factoryCurricula: [],
  knowledgeRoot: '',
  currentChatId: null,
  activeRequestId: null,
  activeAssistantMessageId: null,
  activeRequestMode: null,
  lightboxImagePath: '',
  statsTimer: null,
  bridgeTimer: null,
  lastUnityDetected: false,
  autoModeBusy: false,
  userPinnedToBottom: true,
  scrollDrag: null,
};

const $ = selector => document.querySelector(selector);
const els = {};
const MAX_PINNED_CHATS = 10;

function safeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch (_) { return ''; }
}


function looksLikeImageRequest(value) {
  const source = String(value || '').trim();
  if (!source) return false;
  if (/^\/(image|img)\b/i.test(source)) return true;
  if (/(^|\s)(prompt|promt|prompt positivo|prompt negativo)\b/i.test(source) && !/(genera|generame|generate|create|crear|crea|draw|render|haz|hazme|dibuja).{0,20}(imagen|image|photo|picture|foto|render)/i.test(source)) {
    return false;
  }
  return /(genera|generame|generate|create|crear|crea|haz|hazme|make|draw|render|dibuja|imagina|quiero|necesito|mu[eé]strame).{0,35}(imagen|image|photo|picture|foto|render|illustration|ilustraci[oó]n|portrait|retrato)/i.test(source)
    || /(imagen|image|photo|picture|foto).{0,20}(de|of)\b/i.test(source);
}

function fileSrc(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  const normalized = source.split('\\').join('/');
  if (/^file:\/\//i.test(normalized)) return encodeURI(normalized);
  let clean = normalized;
  while (clean.startsWith('/')) clean = clean.slice(1);
  return encodeURI(`file:///${clean}`);
}

function renderTextLoader() {
  return '<div class="typing-loader-inline" aria-label="Nexa está escribiendo"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>';
}

function renderImageLoader() {
  return '<div class="image-loader-card"><div class="image-loader-logo" aria-hidden="true"></div><div class="image-loader-copy"><strong>Creando imagen…</strong><small>Nexa está generando el prompt positivo y negativo, eligiendo estilo y tamaño, y esperando el render de ComfyUI.</small></div></div>';
}

function renderMessageContent(value) {
  const source = String(value ?? '');
  let output = '';
  let index = 0;
  const isStop = char => !char || char === ' ' || char === '\n' || char === '\r' || char === '\t' || char === '<' || char === '>' || char === '"' || char === "'";
  const trimUrlTail = raw => {
    let body = raw;
    let tail = '';
    while (body.length && '.,;:!?'.includes(body[body.length - 1])) { tail = body[body.length - 1] + tail; body = body.slice(0, -1); }
    return { body, tail };
  };
  while (index < source.length) {
    if (source[index] === '[') {
      const labelEnd = source.indexOf('](', index + 1);
      if (labelEnd > index) {
        const urlEnd = source.indexOf(')', labelEnd + 2);
        if (urlEnd > labelEnd) {
          const label = source.slice(index + 1, labelEnd);
          const rawUrl = source.slice(labelEnd + 2, urlEnd);
          const url = safeHttpUrl(rawUrl);
          if (url) {
            output += '<a class="message-link" href="' + escapeHtml(url) + '" data-external-url="' + escapeHtml(url) + '">' + escapeHtml(label || url) + '</a>';
            index = urlEnd + 1;
            continue;
          }
        }
      }
    }
    const startsHttp = source.startsWith('https://', index) || source.startsWith('http://', index);
    if (startsHttp) {
      let end = index;
      while (end < source.length && !isStop(source[end])) end += 1;
      const parts = trimUrlTail(source.slice(index, end));
      const url = safeHttpUrl(parts.body);
      if (url) {
        output += '<a class="message-link" href="' + escapeHtml(url) + '" data-external-url="' + escapeHtml(url) + '">' + escapeHtml(parts.body) + '</a>' + escapeHtml(parts.tail);
        index = end;
        continue;
      }
    }
    output += escapeHtml(source[index]);
    index += 1;
  }
  return output;
}

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
    libraryIds: [], objectiveIds: [], pinned:false, pinnedAt:null, messages: [],
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
  const filtered = state.chats.slice().filter(chat => !query || String(chat.title || '').toLowerCase().includes(query) || chat.messages.some(m => String(m.content || '').toLowerCase().includes(query)));
  const pinned = filtered.filter(chat => chat.pinned === true).sort((a,b) => String(b.pinnedAt || b.updatedAt).localeCompare(String(a.pinnedAt || a.updatedAt)));
  const recent = filtered.filter(chat => chat.pinned !== true).sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  if (!filtered.length) {
    els.chatList.innerHTML = `<div class="empty-list">${query ? 'No hay coincidencias.' : 'Todavía no hay conversaciones.'}</div>`;
    return;
  }
  const row = chat => `
    <div class="chat-item ${chat.id === state.currentChatId ? 'active' : ''} ${chat.pinned ? 'pinned' : ''}" data-chat-id="${escapeHtml(chat.id)}">
      <button class="chat-pin ${chat.pinned ? 'active' : ''}" data-pin-chat="${escapeHtml(chat.id)}" title="${chat.pinned ? 'Desanclar conversación' : 'Anclar en favoritas'}">${chat.pinned ? '★' : '☆'}</button>
      <div class="chat-item-main">
        <div class="chat-item-title" title="${escapeHtml(chat.title)}">${escapeHtml(chat.title)}</div>
        <div class="chat-item-time">${chat.pinned ? 'Favorita • ' : ''}${relativeTime(chat.updatedAt)}</div>
      </div>
      <button class="chat-delete" data-delete-chat="${escapeHtml(chat.id)}" title="Eliminar">×</button>
    </div>`;
  const sections = [];
  if (pinned.length) sections.push(`<div class="chat-group-label"><span>★ Favoritas</span><span>${pinned.length}/${MAX_PINNED_CHATS}</span></div>${pinned.map(row).join('')}`);
  if (recent.length) sections.push(`<div class="chat-group-label"><span>${pinned.length ? 'Recientes' : 'Conversaciones'}</span><span>${recent.length}</span></div>${recent.map(row).join('')}`);
  els.chatList.innerHTML = sections.join('');
}


function isNearBottom() {
  if (!els.messages || !els.chatScrollShell || els.chatScrollShell.hidden) return true;
  const threshold = 120;
  const remaining = els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight;
  return remaining <= threshold;
}

function updateScrollUi() {
  if (!els.messages || !els.chatScrollShell || els.chatScrollShell.hidden) {
    state.userPinnedToBottom = true;
    if (els.jumpToBottomBtn) els.jumpToBottomBtn.hidden = true;
    return;
  }
  const maxScroll = Math.max(0, els.messages.scrollHeight - els.messages.clientHeight);
  const railHeight = Math.max(1, els.chatScrollRail.clientHeight - 4);
  const viewportRatio = els.messages.scrollHeight > 0 ? Math.min(1, els.messages.clientHeight / els.messages.scrollHeight) : 1;
  const thumbHeight = maxScroll > 0 ? Math.max(46, Math.round(railHeight * viewportRatio)) : railHeight;
  const thumbTravel = Math.max(0, railHeight - thumbHeight);
  const progress = maxScroll > 0 ? Math.min(1, Math.max(0, els.messages.scrollTop / maxScroll)) : 0;
  const thumbTop = Math.round(2 + (thumbTravel * progress));
  els.chatScrollThumb.style.height = String(thumbHeight) + 'px';
  els.chatScrollThumb.style.transform = 'translateY(' + String(thumbTop - 2) + 'px)';
  els.chatScrollRail.classList.toggle('no-overflow', maxScroll <= 0);
  const nearBottom = isNearBottom();
  state.userPinnedToBottom = nearBottom;
  els.jumpToBottomBtn.hidden = false;
  els.jumpToBottomBtn.classList.toggle('at-bottom', nearBottom);
  els.jumpToBottomBtn.title = nearBottom ? 'Ya estás al final de la conversación' : 'Ir al final de la conversación';
}

function scrollMessagesToBottom(force = false) {
  if (!els.messages || !els.chatScrollShell || els.chatScrollShell.hidden) return;
  if (!force && !state.userPinnedToBottom) { updateScrollUi(); return; }
  requestAnimationFrame(() => { els.messages.scrollTop = els.messages.scrollHeight; updateScrollUi(); });
}

function setScrollFromRailPointer(clientY) {
  if (!els.chatScrollRail || !els.messages) return;
  const rect = els.chatScrollRail.getBoundingClientRect();
  const railHeight = Math.max(1, rect.height - 4);
  const thumbHeight = Math.max(1, els.chatScrollThumb.getBoundingClientRect().height);
  const thumbTravel = Math.max(1, railHeight - thumbHeight);
  const maxScroll = Math.max(0, els.messages.scrollHeight - els.messages.clientHeight);
  if (maxScroll <= 0) return;
  const relative = Math.min(thumbTravel, Math.max(0, clientY - rect.top - 2 - (thumbHeight / 2)));
  els.messages.scrollTop = (relative / thumbTravel) * maxScroll;
  updateScrollUi();
}

function beginScrollThumbDrag(event) {
  event.preventDefault();
  event.stopPropagation();
  const maxScroll = Math.max(0, els.messages.scrollHeight - els.messages.clientHeight);
  if (maxScroll <= 0) return;
  state.scrollDrag = { startY:event.clientY, startScrollTop:els.messages.scrollTop };
  els.chatScrollThumb.classList.add('dragging');
  if (els.chatScrollThumb.setPointerCapture) { try { els.chatScrollThumb.setPointerCapture(event.pointerId); } catch (_) {} }
}

function moveScrollThumbDrag(event) {
  if (!state.scrollDrag || !els.chatScrollRail || !els.messages) return;
  const railHeight = Math.max(1, els.chatScrollRail.clientHeight - 4);
  const thumbHeight = Math.max(1, els.chatScrollThumb.getBoundingClientRect().height);
  const thumbTravel = Math.max(1, railHeight - thumbHeight);
  const maxScroll = Math.max(0, els.messages.scrollHeight - els.messages.clientHeight);
  if (maxScroll <= 0) return;
  const deltaY = event.clientY - state.scrollDrag.startY;
  els.messages.scrollTop = state.scrollDrag.startScrollTop + ((deltaY / thumbTravel) * maxScroll);
  updateScrollUi();
}

function endScrollThumbDrag() {
  state.scrollDrag = null;
  if (els.chatScrollThumb) els.chatScrollThumb.classList.remove('dragging');
}

function sourceChips(message) {
  if (!Array.isArray(message.sources) || !message.sources.length) return '';
  var chips = message.sources.map(function (source) {
    var page = source.page ? ' p.' + source.page : '';
    var isWeb = Boolean(source.url || source.sourceType);
    var label = source.documentName || source.libraryName || (isWeb ? 'Fuente web' : 'Fuente');
    var citation = source.citation ? '[' + source.citation + '] ' : '';
    var status = source.verificationStatus ? ' · ' + source.verificationStatus : '';
    var confidence = Number(source.confidence || 0) > 0 ? ' ' + Math.round(Number(source.confidence || 0) * 100) + '%' : '';
    var title = source.url || source.path || '';
    var cls = isWeb ? 'source-chip web-source' : 'source-chip';
    if (source.url && safeHttpUrl(source.url)) {
      return '<button type="button" class="' + cls + ' clickable" data-external-url="' + escapeHtml(source.url) + '" title="Abrir en la web: ' + escapeHtml(title) + '">↗ ' + escapeHtml(citation + label) + page + escapeHtml(status + confidence) + '</button>';
    }
    return '<span class="' + cls + '" title="' + escapeHtml(title) + '">▣ ' + escapeHtml(citation + label) + page + escapeHtml(status + confidence) + '</span>';
  }).join('');
  return '<div class="source-row"><span class="source-row-label">Fuentes usadas</span>' + chips + '</div>';
}

function renderMessageBody(message) {
  const isPending = message.id === state.activeAssistantMessageId;
  const mode = state.activeRequestMode;
  if (message.kind === 'image') {
    const image = message.image || {};
    const hasImage = Boolean(image.path);
    const caption = message.content ? '<div class="image-caption">' + renderMessageContent(message.content) + '</div>' : '';
    if (!hasImage && isPending && mode === 'image') {
      return '<div class="image-message-shell">' + caption + renderImageLoader() + '</div>';
    }
    if (hasImage) {
      const src = fileSrc(image.path);
      const meta = [];
      if (image.style) meta.push('Estilo ' + escapeHtml(image.style));
      if (image.width && image.height) meta.push(escapeHtml(String(image.width) + '×' + String(image.height)));
      const metaHtml = meta.length ? '<small>' + meta.join(' · ') + '</small>' : '';
      return '<div class="image-message-shell"><div class="image-card clean">' +
        caption +
        '<button type="button" class="generated-image-button" data-open-image="' + escapeHtml(image.path) + '" data-image-meta="' + escapeHtml(meta.join(' · ')) + '"><img class="generated-chat-image" src="' + src + '" alt="Imagen generada por Nexa" loading="lazy" /></button>' +
        '<div class="image-card-actions">' +
          '<button type="button" class="image-card-action" data-open-image="' + escapeHtml(image.path) + '" data-image-meta="' + escapeHtml(meta.join(' · ')) + '">Ver grande</button>' +
          '<button type="button" class="image-card-action" data-download-image="' + escapeHtml(image.path) + '">Descargar</button>' +
        '</div>' + metaHtml +
      '</div></div>';
    }
    return '<div class="image-message-shell">' + caption + '</div>';
  }
  if (isPending && mode === 'text' && !String(message.content || '').trim() && message.role === 'assistant') return renderTextLoader();
  return renderMessageContent(message.content);
}

function renderMessageActions(message) {
  if (message.kind === 'image') return '';
  if (!String(message.content || '').trim()) return '';
  return '<div class="message-actions">' +
    '<button class="message-action" data-memory-message="' + escapeHtml(message.id) + '">Guardar en memoria</button>' +
    '<button class="message-action" data-knowledge-message="' + escapeHtml(message.id) + '">Guardar en conocimiento</button>' +
    '<button class="message-action" data-copy-message="' + escapeHtml(message.id) + '">Copiar</button>' +
  '</div>';
}

function renderCurrentChat() {
  const chat = currentChat();
  els.chatTitle.value = chat?.title || 'Nuevo chat';
  if (!chat || !chat.messages.length) {
    els.welcomeState.hidden = false;
    els.chatScrollShell.hidden = true;
    els.messages.innerHTML = '';
    if (els.jumpToBottomBtn) els.jumpToBottomBtn.hidden = true;
    return;
  }
  els.welcomeState.hidden = true;
  els.chatScrollShell.hidden = false;
  els.messages.innerHTML = chat.messages.map(message => {
    const bodyClass = message.kind === 'image' ? 'message-content image-content' : 'message-content';
    return `
    <article class="message ${escapeHtml(message.role)} ${message.kind === 'image' ? 'message-image' : ''}" data-message-id="${escapeHtml(message.id)}">
      <div class="avatar">${message.role === 'assistant' ? 'N' : 'TÚ'}</div>
      <div>
        <div class="message-head"><span class="message-author">${message.role === 'assistant' ? 'Nexa AI' : 'Tú'}</span><span class="message-time">${formatTime(message.createdAt)}</span></div>
        <div class="${bodyClass}">${renderMessageBody(message)}</div>
        ${renderMessageActions(message)}
      </div>
    </article>`;
  }).join('');
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
  if (node) node.innerHTML = renderMessageContent(message.content);
  else renderCurrentChat();
  scrollMessagesToBottom();
}

function attachSources(sources) {
  const chat = currentChat();
  const message = chat?.messages.find(item => item.id === state.activeAssistantMessageId);
  if (!message) return;
  // Keep source metadata attached for grounding and Knowledge, but do not show source chips in the visible chat.
  message.sources = Array.isArray(sources) ? sources : [];
}

function setGenerating(active, mode = null) {
  state.activeRequestMode = active ? (mode || state.activeRequestMode || 'text') : null;
  els.generationBanner.hidden = !active;
  els.generationBanner.style.display = active ? 'flex' : 'none';
  if (active) {
    const imageMode = state.activeRequestMode === 'image';
    els.generationBannerLabel.textContent = imageMode ? 'Preparando generación de imagen…' : 'Nexa está escribiendo…';
    els.generationBannerVisual.className = 'banner-loader ' + (imageMode ? 'image-loader' : 'text-loader');
    els.generationBannerVisual.innerHTML = imageMode
      ? ''
      : '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
  } else {
    els.generationBannerLabel.textContent = '';
    els.generationBannerVisual.className = 'banner-loader text-loader';
    els.generationBannerVisual.innerHTML = '';
  }
  els.sendBtn.disabled = active;
  els.promptInput.disabled = active;
  if (!active) els.promptInput.focus();
}

function updateImageProgress(label) {
  if (state.activeRequestMode !== 'image') return;
  const clean = String(label || '').trim();
  if (clean) els.generationBannerLabel.textContent = clean;
  const inline = els.messages?.querySelector('.image-loader-copy small');
  if (inline && clean) inline.textContent = clean;
}

function invokeImageWithTimeout(requestId, payload, timeoutMs = 360000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (window.nexa.images?.stop) window.nexa.images.stop(requestId).catch(() => {});
      reject(new Error('La generación de imagen superó 6 minutos y fue detenida para evitar que Nexa quede bloqueado.'));
    }, timeoutMs);
    window.nexa.images.generate(payload).then(result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }).catch(error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function sendMessage() {
  const text = els.promptInput.value.trim();
  if (!text || state.activeRequestId) return;
  const chat = ensureChat();
  const wantsImage = looksLikeImageRequest(text);
  const requestId = uid('req');
  const now = new Date().toISOString();

  chat.messages.push({ id:uid('msg'), role:'user', kind:'text', content:text, createdAt:now, sources:[] });
  autoTitle(chat);
  const assistantMessage = { id:uid('msg'), role:'assistant', kind:wantsImage ? 'image' : 'text', content:'', image:null, createdAt:new Date().toISOString(), sources:[] };
  chat.messages.push(assistantMessage);
  const assistantMessageId = assistantMessage.id;

  state.activeRequestId = requestId;
  state.activeAssistantMessageId = assistantMessageId;
  els.promptInput.value = '';
  resizePrompt();
  setGenerating(true, wantsImage ? 'image' : 'text');
  renderCurrentChat();

  try {
    await persistChat(chat);
  } catch (error) {
    if (state.activeRequestId === requestId) finishWithError(error.message || String(error));
    return;
  }

  if (wantsImage) {
    try {
      const result = await invokeImageWithTimeout(requestId, { requestId, userRequest:text });
      if (state.activeRequestId !== requestId) return;
      if (!result?.ok || !result?.image?.path) throw new Error(result?.error || 'No se pudo generar la imagen.');
      const assistant = chat.messages.find(message => message.id === assistantMessageId);
      if (assistant) {
        assistant.kind = 'image';
        assistant.content = result.summary || 'Aquí tienes la imagen.';
        assistant.image = result.image;
      }
      await persistChat(chat);
      renderCurrentChat();
      toast('Imagen generada en ComfyUI.','success');
    } catch (error) {
      if (state.activeRequestId !== requestId) return;
      const message = error.message || String(error);
      const assistant = chat.messages.find(item => item.id === assistantMessageId);
      if (assistant && !assistant.image?.path) assistant.content = `Error local: ${message}`;
      await persistChat(chat).catch(() => {});
      renderCurrentChat();
      toast(message,'error');
    } finally {
      if (state.activeRequestId === requestId) {
        state.activeRequestId = null;
        state.activeAssistantMessageId = null;
        setGenerating(false);
        renderCurrentChat();
      }
    }
    return;
  }

  try {
    const result = await window.nexa.chat.start({
      requestId,
      libraryIds: Array.isArray(chat.libraryIds) ? chat.libraryIds : [],
      objectiveIds: Array.isArray(chat.objectiveIds) ? chat.objectiveIds : [],
      messages: chat.messages.filter(message => message.id !== assistantMessageId).map(message => ({ role:message.role, content:message.content })),
    });
    if (!result?.ok) throw new Error(result?.error || 'No se pudo iniciar la respuesta.');
    if (Array.isArray(result.sources) && result.sources.length) attachSources(result.sources);
  } catch (error) {
    if (state.activeRequestId === requestId) finishWithError(error.message || String(error));
  }
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
  if (state.activeRequestMode === 'image' && window.nexa.images?.stop) {
    const requestId = state.activeRequestId;
    const chat = currentChat();
    const assistant = chat?.messages.find(item => item.id === state.activeAssistantMessageId);
    if (assistant && !assistant.image?.path) assistant.content = 'Generación de imagen detenida.';
    state.activeRequestId = null;
    state.activeAssistantMessageId = null;
    setGenerating(false);
    renderCurrentChat();
    if (chat) persistChat(chat).catch(() => {});
    window.nexa.images.stop(requestId).catch(error => toast(error.message || String(error),'error'));
    return;
  }
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


async function refreshFactory() {
  if (!window.nexa.factory) return;
  try { state.factoryCurricula = await window.nexa.factory.list() || []; }
  catch (_) { state.factoryCurricula = []; }
  renderFactory();
}

function renderFactory() {
  if (!els.factoryList) return;
  const rows = state.factoryCurricula || [];
  if (!rows.length) {
    els.factoryList.innerHTML = '<div class="empty-list">No hay listas maestras todavía. Crea Toyota Corolla u otro modelo y Nexa generará la cola por años.</div>';
    return;
  }
  els.factoryList.innerHTML = rows.map(function (row) {
    const years = Number(row.year_count || 0), done = Number(row.complete_years || 0), review = Number(row.review_years || 0);
    const configs = Number(row.config_count || 0), doneConfigs = Number(row.complete_configs || 0);
    const pct = years ? Math.round(((done + review) / years) * 100) : 0;
    const status = String(row.status || 'PAUSED');
    const badgeClass = status === 'RUNNING' ? 'lime' : (status === 'COMPLETE' ? 'blue' : (status === 'ERROR' ? 'red' : 'muted'));
    return '<article class="factory-card" data-factory-id="' + escapeHtml(row.id) + '">' +
      '<div class="factory-head"><div><strong>' + escapeHtml(row.name) + '</strong><small>' + escapeHtml(row.make + ' ' + row.model + ' • ' + row.start_year + '–' + row.end_year + ' • ' + row.market + ' • objetivo ' + Math.round(Number(row.completion_threshold || .85)*100) + '%') + '</small></div><span class="badge ' + badgeClass + '">' + escapeHtml(status) + '</span></div>' +
      '<div class="factory-meter"><div class="meter"><div class="meter-fill" style="width:' + pct + '%"></div></div></div>' +
      '<div class="factory-summary"><div><strong>' + done + '/' + years + '</strong><small>AÑOS</small></div><div><strong>' + configs + '</strong><small>CONFIGS</small></div><div><strong>' + doneConfigs + '</strong><small>COMPLETE</small></div><div><strong>' + review + '</strong><small>REVIEW</small></div></div>' +
      '<div class="factory-current">La fábrica termina las configuraciones de un año antes de pasar al siguiente. PARTIAL cuenta como cobertura parcial; VERIFIED conserva mayor confianza.</div>' +
      '<div class="factory-actions">' +
        (status === 'RUNNING' ? '<button class="tiny pause" data-factory-pause="' + escapeHtml(row.id) + '">Pausar</button>' : '<button class="tiny start" data-factory-start="' + escapeHtml(row.id) + '">Iniciar / continuar</button>') +
        '<button class="tiny" data-factory-years="' + escapeHtml(row.id) + '">Ver años</button>' +
        '<button class="tiny danger" data-factory-delete="' + escapeHtml(row.id) + '">Eliminar lista</button>' +
      '</div></article>';
  }).join('');
}

async function createFactoryFromForm(event) {
  event.preventDefault();
  const input = {
    make:els.factoryMake.value.trim(), model:els.factoryModel.value.trim(),
    startYear:Number(els.factoryStartYear.value), endYear:Number(els.factoryEndYear.value),
    market:els.factoryMarket.value.trim() || 'US', completionThreshold:(Number(els.factoryThreshold.value)||85)/100,
  };
  if (!input.make || !input.model || !input.startYear || !input.endYear) return toast('Fabricante, modelo y rango de años son obligatorios.','error');
  try {
    await window.nexa.factory.create(input);
    await refreshFactory();
    toast('Lista maestra creada. Presiona Iniciar para comenzar el ciclo automático.','success');
  } catch (error) { toast(error.message || String(error),'error'); }
}

async function showFactoryYears(curriculumId) {
  const years = await window.nexa.factory.years(curriculumId);
  const lines = (years || []).map(y => y.year + ': ' + y.discovery_status + ' / ' + y.research_status + ' / ' + Math.round(Number(y.coverage||0)*100) + '%' + (y.last_error ? ('\n  ↳ ' + y.last_error) : ''));
  window.alert(lines.join('\n') || 'No hay años en esta lista.');
}

function selectedObjectiveIdsForChat(chat = currentChat()) {
  if (!chat || !Array.isArray(chat.objectiveIds)) return [];
  return chat.objectiveIds.filter(function (id) { return state.objectives.some(function (obj) { return obj.id === id && obj.enabled !== false; }); });
}

async function refreshPersistentKnowledge() {
  var result = await Promise.all([window.nexa.knowledgeDb.objectives(), window.nexa.knowledgeDb.stats()]);
  state.objectives = Array.isArray(result[0]) ? result[0] : [];
  state.knowledgeDbStats = result[1] || null;
  renderPersistentKnowledge();
  renderLibraries();
}

function objectiveSubtitle(obj) {
  if (obj.type === 'automotive') {
    return [obj.make, obj.model, obj.year, obj.engine_code || obj.engine_displacement, obj.transmission, obj.market].filter(Boolean).join(' • ');
  }
  return [obj.category, obj.description].filter(Boolean).join(' • ').slice(0, 180);
}

function renderPersistentKnowledge() {
  var stats = state.knowledgeDbStats || {};
  if (els.knowledgeDbStats) els.knowledgeDbStats.textContent = String(stats.active_entries || 0) + ' entradas activas • ' + String(stats.verified_entries || 0) + ' verificadas • ' + String(stats.partial_entries || 0) + ' parciales • ' + String(stats.saved_evidence || 0) + ' evidencias • ' + String(stats.knowledge_sources || 0) + ' fuentes';
  if (els.knowledgeDbPath) els.knowledgeDbPath.textContent = stats.dbPath || 'D\\LocalAI\\NexaAI\\Data\\nexa-knowledge.db';
  if (!els.objectiveList) return;
  if (!state.objectives.length) {
    els.objectiveList.innerHTML = '<div class="empty-list">Todavía no hay objetivos. Crea uno para que Nexa pueda detectar qué conocimiento falta y completarlo.</div>';
    return;
  }
  var selectedIds = selectedObjectiveIdsForChat();
  els.objectiveList.innerHTML = state.objectives.map(function (obj) {
    var selected = selectedIds.includes(obj.id);
    var subtitle = objectiveSubtitle(obj);
    return '<article class="objective-card" data-objective-id="' + escapeHtml(obj.id) + '">' +
      '<div class="objective-head"><div><strong>' + escapeHtml(obj.name) + '</strong><small>' + escapeHtml(subtitle || obj.type) + '</small></div>' +
      '<span class="badge ' + (obj.type === 'automotive' ? 'blue' : 'muted') + '">' + escapeHtml(String(obj.type || 'general').toUpperCase()) + '</span></div>' +
      '<div class="objective-status-grid">' +
        '<div class="objective-stat"><strong>' + Number(obj.verified_count || 0) + '</strong><small>VERIFIED</small></div>' +
        '<div class="objective-stat"><strong>' + Number(obj.partial_count || 0) + '</strong><small>PARTIAL</small></div>' +
        '<div class="objective-stat"><strong>' + Number(obj.missing_count || 0) + '</strong><small>MISSING</small></div>' +
        '<div class="objective-stat"><strong>' + Number(obj.entry_count || 0) + '</strong><small>ENTRIES</small></div>' +
      '</div>' +
      '<label class="objective-chat-toggle"><input type="checkbox" data-objective-chat="' + escapeHtml(obj.id) + '" ' + (selected ? 'checked' : '') + ' ' + (obj.enabled === false ? 'disabled' : '') + '/><span>Usar este objetivo en el chat</span></label>' +
      '<div class="objective-topic-row"><input data-topic-input="' + escapeHtml(obj.id) + '" placeholder="Tema específico: P0302 / Fuel Pressure / Quantum mechanics"/><button class="tiny research-button" data-research-topic="' + escapeHtml(obj.id) + '">Investigar</button></div>' +
      '<div class="objective-actions"><button class="tiny research-button" data-research-missing="' + escapeHtml(obj.id) + '">Completar faltantes</button>' +
      '<button class="tiny" data-toggle-objective="' + escapeHtml(obj.id) + '">' + (obj.enabled === false ? 'Activar' : 'Pausar') + '</button>' +
      '<button class="tiny danger" data-delete-objective="' + escapeHtml(obj.id) + '">Eliminar</button></div>' +
      '</article>';
  }).join('');
}

async function saveMessageToKnowledge(message) {
  var selectedIds = selectedObjectiveIdsForChat();
  if (!selectedIds.length) {
    toast('Selecciona “Usar este objetivo en el chat” antes de guardar conocimiento.','error');
    showPanel('knowledge');
    return;
  }
  if (selectedIds.length > 1) {
    toast('Selecciona un solo objetivo para guardar este mensaje sin mezclar conocimiento.','error');
    showPanel('knowledge');
    return;
  }
  var objective = state.objectives.find(function (obj) { return obj.id === selectedIds[0]; });
  if (!objective) return;
  var suggested = normalizeWhitespace(message.content).slice(0, 90) || 'Knowledge from chat';
  var topic = window.prompt('Tema para guardar en el conocimiento persistente:', suggested);
  if (!topic || !topic.trim()) return;
  var result = await window.nexa.knowledgeDb.save({
    objective_id: objective.id,
    system: objective.type === 'automotive' ? 'User / Chat Knowledge' : objective.category || 'General',
    subsystem: '', topic: topic.trim(),
    summary: message.content,
    content: { text:message.content, origin_role:message.role, chat_id:state.currentChatId },
    confidence: message.role === 'assistant' ? 0.60 : 0.70,
    verification_status: 'PARTIAL',
    source: { name:'Nexa AI chat', title:'Manual save from chat', url:'', source_type:'User / Chat', access_date:new Date().toISOString(), license_note:'User explicitly requested persistent storage.' },
  });
  await refreshPersistentKnowledge();
  toast(result?.duplicate ? 'Ese conocimiento ya existía; se actualizó la metadata.' : 'Guardado realmente en nexa-knowledge.db.','success');
}

async function createObjectiveFromForm(event) {
  event.preventDefault();
  var type = els.objectiveType.value === 'automotive' ? 'automotive' : 'general';
  var input = {
    type:type, name:els.objectiveName.value.trim(), description:els.objectiveDescription.value.trim(),
    make:els.objectiveMake.value.trim(), model:els.objectiveModel.value.trim(), year:Number(els.objectiveYear.value)||null,
    engine_code:els.objectiveEngine.value.trim(), engine_displacement:els.objectiveDisplacement.value.trim(),
    transmission:els.objectiveTransmission.value.trim(), market:els.objectiveMarket.value.trim(), trim:els.objectiveTrim.value.trim(),
  };
  if (type === 'general' && !input.name) return toast('Escribe un nombre para el objetivo general.','error');
  try {
    var created = await window.nexa.knowledgeDb.createObjective(input);
    var chat = ensureChat();
    chat.objectiveIds = [created.id];
    await persistChat(chat);
    els.objectiveName.value=''; els.objectiveDescription.value='';
    await refreshPersistentKnowledge();
    toast('Objetivo creado en la base persistente.','success');
  } catch (error) { toast(error.message || String(error),'error'); }
}

async function runObjectiveResearch(objectiveId, topic) {
  var clean = String(topic || '').trim();
  if (!clean) return toast('Escribe un tema para investigar.','error');
  els.researchProgress.hidden = false;
  els.researchProgressText.textContent = 'Buscando y validando: ' + clean;
  els.researchProgressState.textContent = 'WEB';
  var result = await window.nexa.research.topic(objectiveId, clean, {});
  await refreshPersistentKnowledge();
  if (result?.ok && result?.saved) {
    toast('Guardado en nexa-knowledge.db como ' + String(result.verification_status || 'PARTIAL') + ' (' + Math.round(Number(result.confidence || 0) * 100) + '%).','success');
  } else if (result?.ok && result?.evidenceSaved) {
    toast('Las fuentes y la evidencia quedaron guardadas persistentemente, pero el tema sigue pendiente de confirmación.');
  } else if (result?.ok) {
    toast('Investigación terminada sin evidencia utilizable: ' + String(result.reason || result.verification_status || 'NOT VERIFIED'));
  } else toast(result?.error || 'La investigación no pudo completarse.','error');
  setTimeout(function () { els.researchProgress.hidden = true; }, 1800);
}

async function runMissingResearch(objectiveId) {
  els.researchProgress.hidden = false;
  els.researchProgressText.textContent = 'Completando conocimiento faltante…';
  els.researchProgressState.textContent = 'WEB';
  var result = await window.nexa.research.missing(objectiveId, Number(state.settings.researchBatchSize || 3));
  await refreshPersistentKnowledge();
  var rows = Array.isArray(result?.results) ? result.results : [];
  var saved = rows.filter(function (item) { return item.saved; }).length;
  var evidence = rows.filter(function (item) { return item.evidenceSaved; }).length;
  var verified = rows.filter(function (item) { return item.saved && item.verification_status === 'VERIFIED'; }).length;
  var partial = rows.filter(function (item) { return item.saved && item.verification_status === 'PARTIAL'; }).length;
  var message = 'Investigación: ' + verified + ' VERIFIED, ' + partial + ' PARTIAL, ' + evidence + ' con evidencia persistente.';
  toast(message, saved ? 'success' : '');
  setTimeout(function () { els.researchProgress.hidden = true; }, 1800);
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
  var dbEntries = Number(state.knowledgeDbStats?.active_entries || 0);
  els.knowledgeTopStatus.textContent = dbEntries || libs.length ? (dbEntries + ' hechos • ' + libs.length + ' librerías') : 'Knowledge local';
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
  const objectiveIds = selectedObjectiveIdsForChat();
  const pair = await Promise.all([
    window.nexa.knowledgeDb.search(query, { objectiveIds:objectiveIds, limit:8, minConfidence:0 }),
    window.nexa.knowledge.search(query, { libraryIds:libraryIds, limit:8 }),
  ]);
  const persistent = Array.isArray(pair[0]) ? pair[0] : [];
  const documents = Array.isArray(pair[1]) ? pair[1] : [];
  if (!persistent.length && !documents.length) {
    els.knowledgeSearchResults.innerHTML = '<div class="empty-list">No encontré coincidencias en la base persistente ni en las librerías activas.</div>';
    return;
  }
  var persistentHtml = persistent.map(function (result) {
    var preview = escapeHtml(String(result.summary || '').slice(0,280)) + (String(result.summary || '').length > 280 ? '…' : '');
    var source = result.source_title || result.source_name || result.source_url || 'Base persistente';
    return '<div class="knowledge-hit persistent-hit"><strong>' + escapeHtml(result.topic) + '<span class="knowledge-status">' + escapeHtml(result.verification_status) + ' ' + Number(result.confidence || 0).toFixed(2) + '</span></strong>' +
      '<small>' + escapeHtml(result.objective_name || 'Knowledge DB') + ' • ' + escapeHtml(source) + '</small><p>' + preview + '</p></div>';
  }).join('');
  var documentHtml = documents.map(function (result) {
    var pageText = result.page ? (' • pág. ' + result.page) : '';
    var rawText = String(result.text || '');
    var preview = escapeHtml(rawText.slice(0,260)) + (rawText.length > 260 ? '…' : '');
    return '<div class="knowledge-hit"><strong>' + escapeHtml(result.documentName) + pageText + '</strong><small>' + escapeHtml(result.libraryName) + ' • score ' + result.score + '</small><p>' + preview + '</p></div>';
  }).join('');
  els.knowledgeSearchResults.innerHTML = persistentHtml + documentHtml;
}

function showPanel(name) {
  document.querySelectorAll('.nav-button').forEach(button => button.classList.toggle('active', button.dataset.panel === name));
  document.querySelectorAll('[data-panel-view]').forEach(panel => panel.classList.toggle('active', panel.dataset.panelView === name));
  const meta = {
    system:['Sistema','Estado local en tiempo real'],
    memory:['Memoria','Recuerdos persistentes independientes del modelo'],
    knowledge:['Knowledge','Base persistente, documentos e investigación web'],
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
  els.settingComfyBaseUrl.value = state.settings.comfyBaseUrl || 'http://127.0.0.1:8188';
  els.settingComfyCheckpoint.value = state.settings.comfyCheckpoint || '';
  els.settingAutoUnity.checked = Boolean(state.settings.autoUnityMode);
  els.settingKnowledgeChunks.value = state.settings.knowledgeMaxChunks || 6;
  els.settingKnowledgeChars.value = state.settings.knowledgeMaxChars || 7500;
  els.includeKnowledge.checked = state.settings.includeKnowledge !== false;
  els.settingInternetResearch.checked = state.settings.internetResearchEnabled !== false;
  els.settingAutoResearch.checked = state.settings.autoResearchOnMissing !== false;
  els.settingWebSources.value = state.settings.webMaxSources || 5;
  els.settingResearchBatch.value = state.settings.researchBatchSize || 3;
}

async function refreshBridgeStatus() {
  if (!window.nexa.bridge) return;
  try {
    const status = await window.nexa.bridge.status();
    state.bridgeStatus = status || null;
    els.bridgeApiBase.value = status?.baseUrl || 'http://127.0.0.1:32145';
    els.bridgeToken.value = status?.pairingToken || '';
    els.bridgeStatusBadge.textContent = status?.extensionWorkerOnline ? 'EXT ONLINE' : (status?.ok ? 'API ONLINE' : 'OFFLINE');
    els.bridgeStatusBadge.className = 'badge ' + (status?.extensionWorkerOnline ? 'lime' : (status?.ok ? 'blue' : 'red'));
    els.bridgeLastError.hidden = !status?.lastError;
    els.bridgeLastError.textContent = status?.lastError || '';
  } catch (error) {
    els.bridgeStatusBadge.textContent = 'ERROR';
    els.bridgeStatusBadge.className = 'badge red';
    els.bridgeLastError.hidden = false;
    els.bridgeLastError.textContent = error.message || String(error);
  }
}

async function copyBridgeToken() {
  const value = els.bridgeToken.value || '';
  if (!value) return toast('No hay pairing token disponible.','error');
  await navigator.clipboard.writeText(value);
  toast('Pairing token copiado.','success');
}

async function regenerateBridgeToken() {
  if (!confirm('¿Regenerar el pairing token? La extensión actual dejará de conectarse hasta que pegues el token nuevo.')) return;
  const status = await window.nexa.bridge.regenerateToken();
  state.bridgeStatus = status || null;
  await refreshBridgeStatus();
  toast('Pairing token regenerado.','success');
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
    comfyBaseUrl: els.settingComfyBaseUrl.value.trim() || 'http://127.0.0.1:8188',
    comfyCheckpoint: els.settingComfyCheckpoint.value.trim(),
    autoUnityMode: els.settingAutoUnity.checked,
    knowledgeMaxChunks: Number(els.settingKnowledgeChunks.value) || 6,
    knowledgeMaxChars: Number(els.settingKnowledgeChars.value) || 7500,
    internetResearchEnabled: els.settingInternetResearch.checked,
    autoResearchOnMissing: els.settingAutoResearch.checked,
    webMaxSources: Number(els.settingWebSources.value) || 5,
    researchBatchSize: Number(els.settingResearchBatch.value) || 3,
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

async function downloadImage(filePath) {
  if (!filePath || !window.nexa.images?.saveAs) return;
  try {
    const result = await window.nexa.images.saveAs(filePath);
    if (result?.ok) toast('Imagen descargada.','success');
  } catch (error) {
    toast(error.message || String(error),'error');
  }
}

function openImageLightbox(filePath, meta = '') {
  if (!filePath) return;
  state.lightboxImagePath = filePath;
  els.imageLightboxImg.src = fileSrc(filePath);
  els.imageLightboxTitle.textContent = 'Imagen generada';
  els.imageLightboxMeta.textContent = meta || 'Vista grande';
  els.imageLightbox.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeImageLightbox() {
  state.lightboxImagePath = '';
  els.imageLightbox.hidden = true;
  els.imageLightboxImg.removeAttribute('src');
  document.body.style.overflow = '';
}

function cacheElements() {
  const ids = [
    'newChatBtn','chatSearch','chatList','chatTitle','brandVersion','engineDot','engineText','modelText','knowledgeTopStatus','fastModeBtn','lightModeBtn',
    'welcomeState','welcomeStartEngine','welcomeWarmModel','chatScrollShell','messages','chatScrollRail','chatScrollThumb','jumpToBottomBtn','generationBanner','generationBannerLabel','generationBannerVisual','stopBtn','promptInput','sendBtn','composerHint',
    'inspectorTitle','inspectorSubtitle','refreshBtn','ollamaBadge','startEngineBtn','warmModelBtn','unloadModelBtn','ramLabel','ramBar','aiRam','unityRam',
    'vramLabel','vramBar','aiVram','otherVram','gpuUsage','gpuTemp','profileBadge','profileDescription','unityBadge','unityAdvice',
    'memoryForm','memoryInput','memoryCount','includeMemories','memoryList',
    'knowledgeDbBadge','knowledgeDbStats','knowledgeDbPath','factoryForm','factoryMake','factoryModel','factoryStartYear','factoryEndYear','factoryMarket','factoryThreshold','factoryToyotaCorollaPreset','factoryProgress','factoryProgressText','factoryProgressState','factoryList','objectiveForm','objectiveType','objectiveName','objectiveAutomotiveFields','objectiveMake','objectiveModel','objectiveYear','objectiveEngine','objectiveDisplacement','objectiveTransmission','objectiveMarket','objectiveTrim','objectiveDescription','researchProgress','researchProgressText','researchProgressState','objectiveList',
    'libraryForm','libraryName','libraryCategory','knowledgeProgress','knowledgeProgressText','knowledgeProgressPct','knowledgeProgressBar','knowledgeCount','includeKnowledge','libraryList',
    'knowledgeSearchInput','knowledgeSearchBtn','knowledgeSearchResults','openKnowledgeBtn',
    'settingsForm','settingModel','settingBaseUrl','settingOllamaExe','settingModelsPath','settingContext','settingLightLayers','settingKeepAlive','settingComfyBaseUrl','settingComfyCheckpoint','settingAutoUnity',
    'settingKnowledgeChunks','settingKnowledgeChars','settingInternetResearch','settingAutoResearch','settingWebSources','settingResearchBatch','openDataBtn','bridgeStatusBadge','bridgeApiBase','bridgeToken','copyBridgeTokenBtn','toggleBridgeTokenBtn','regenerateBridgeTokenBtn','bridgeLastError','versionLabel','imageLightbox','imageLightboxImg','imageLightboxTitle','imageLightboxMeta','imageLightboxDownload','imageLightboxClose','toastHost',
  ];
  for (const id of ids) els[id] = document.getElementById(id);
}

function bindEvents() {
  els.newChatBtn.addEventListener('click', () => {
    const chat = { id:uid('chat'), title:'Nuevo chat', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), libraryIds:[], objectiveIds:[], pinned:false, pinnedAt:null, messages:[] };
    state.chats.unshift(chat); state.currentChatId = chat.id; renderChats(); renderCurrentChat(); renderLibraries(); els.promptInput.focus();
  });
  els.chatSearch.addEventListener('input', renderChats);
  els.chatList.addEventListener('click', async event => {
    const pinButton = event.target.closest('[data-pin-chat]');
    if (pinButton) {
      event.stopPropagation();
      const chat = state.chats.find(item => item.id === pinButton.dataset.pinChat);
      if (!chat) return;
      if (!chat.pinned && state.chats.filter(item => item.pinned === true).length >= MAX_PINNED_CHATS) {
        toast('Puedes anclar un máximo de 10 conversaciones favoritas.','error');
        return;
      }
      chat.pinned = !chat.pinned;
      chat.pinnedAt = chat.pinned ? new Date().toISOString() : null;
      await persistChat(chat);
      toast(chat.pinned ? 'Conversación anclada en favoritas.' : 'Conversación desanclada.','success');
      return;
    }
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
  els.chatScrollRail.addEventListener('pointerdown', event => { if (event.target === els.chatScrollThumb) return; setScrollFromRailPointer(event.clientY); });
  els.chatScrollThumb.addEventListener('pointerdown', beginScrollThumbDrag);
  window.addEventListener('pointermove', moveScrollThumbDrag);
  window.addEventListener('pointerup', endScrollThumbDrag);
  window.addEventListener('pointercancel', endScrollThumbDrag);
  window.addEventListener('resize', updateScrollUi);
  els.promptInput.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } });
  document.addEventListener('keydown', event => {
    if (event.ctrlKey && event.key.toLowerCase() === 'n') { event.preventDefault(); els.newChatBtn.click(); }
    if (event.key === 'Escape' && !els.imageLightbox.hidden) closeImageLightbox();
  });
  els.imageLightboxClose.addEventListener('click', closeImageLightbox);
  els.imageLightboxDownload.addEventListener('click', () => downloadImage(state.lightboxImagePath));
  els.imageLightbox.addEventListener('click', event => { if (event.target.closest('[data-close-lightbox]')) closeImageLightbox(); });
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
    const externalLink = event.target.closest('[data-external-url]');
    if (externalLink) {
      event.preventDefault();
      event.stopPropagation();
      const url = safeHttpUrl(externalLink.dataset.externalUrl || externalLink.getAttribute('href') || '');
      if (url) {
        try { await window.nexa.system.openExternal(url); }
        catch (error) { toast(error.message || String(error),'error'); }
      }
      return;
    }
    const openImageButton = event.target.closest('[data-open-image]');
    if (openImageButton) {
      openImageLightbox(openImageButton.dataset.openImage, openImageButton.dataset.imageMeta || 'Vista grande');
      return;
    }
    const downloadImageButton = event.target.closest('[data-download-image]');
    if (downloadImageButton) {
      await downloadImage(downloadImageButton.dataset.downloadImage);
      return;
    }
    const memoryButton = event.target.closest('[data-memory-message]');
    const knowledgeButton = event.target.closest('[data-knowledge-message]');
    const copyButton = event.target.closest('[data-copy-message]');
    const chat = currentChat(); if (!chat) return;
    if (memoryButton) { const message = chat.messages.find(item => item.id === memoryButton.dataset.memoryMessage); if (message) await saveMemory(message.content); }
    if (knowledgeButton) { const message = chat.messages.find(item => item.id === knowledgeButton.dataset.knowledgeMessage); if (message) await saveMessageToKnowledge(message); }
    if (copyButton) { const message = chat.messages.find(item => item.id === copyButton.dataset.copyMessage); if (message) { await navigator.clipboard.writeText(message.content); toast('Copiado.'); } }
  });

  els.factoryForm.addEventListener('submit', createFactoryFromForm);
  els.factoryToyotaCorollaPreset.addEventListener('click', () => {
    els.factoryMake.value='Toyota'; els.factoryModel.value='Corolla'; els.factoryStartYear.value='1969'; els.factoryEndYear.value='2027'; els.factoryMarket.value='US'; els.factoryThreshold.value='85';
  });
  els.factoryList.addEventListener('click', async event => {
    const start=event.target.closest('[data-factory-start]');
    if (start) { await window.nexa.factory.start(start.dataset.factoryStart); await refreshFactory(); toast('Auto Knowledge Factory iniciada.','success'); return; }
    const pause=event.target.closest('[data-factory-pause]');
    if (pause) { await window.nexa.factory.pause(pause.dataset.factoryPause); await refreshFactory(); toast('Fábrica pausada.'); return; }
    const years=event.target.closest('[data-factory-years]');
    if (years) { await showFactoryYears(years.dataset.factoryYears); return; }
    const del=event.target.closest('[data-factory-delete]');
    if (del) { if (!confirm('¿Eliminar esta lista maestra? Los objetivos/conocimiento ya guardados NO se borrarán.')) return; await window.nexa.factory.delete(del.dataset.factoryDelete); await refreshFactory(); toast('Lista maestra eliminada.'); }
  });

  els.objectiveType.addEventListener('change', () => { els.objectiveAutomotiveFields.hidden = els.objectiveType.value !== 'automotive'; });
  els.objectiveForm.addEventListener('submit', createObjectiveFromForm);
  els.objectiveList.addEventListener('change', async event => {
    const toggle = event.target.closest('[data-objective-chat]');
    if (!toggle) return;
    const chat = ensureChat();
    let ids = Array.isArray(chat.objectiveIds) ? chat.objectiveIds.slice() : [];
    if (toggle.checked) { if (!ids.includes(toggle.dataset.objectiveChat)) ids.push(toggle.dataset.objectiveChat); }
    else ids = ids.filter(function (id) { return id !== toggle.dataset.objectiveChat; });
    chat.objectiveIds = ids;
    await persistChat(chat); renderPersistentKnowledge();
  });
  els.objectiveList.addEventListener('click', async event => {
    const research = event.target.closest('[data-research-topic]');
    if (research) {
      const input = els.objectiveList.querySelector('[data-topic-input="' + CSS.escape(research.dataset.researchTopic) + '"]');
      return runObjectiveResearch(research.dataset.researchTopic, input ? input.value : '');
    }
    const missing = event.target.closest('[data-research-missing]');
    if (missing) return runMissingResearch(missing.dataset.researchMissing);
    const toggle = event.target.closest('[data-toggle-objective]');
    if (toggle) {
      const obj = state.objectives.find(function (item) { return item.id === toggle.dataset.toggleObjective; });
      if (!obj) return;
      await window.nexa.knowledgeDb.updateObjective(obj.id, { enabled:obj.enabled === false });
      await refreshPersistentKnowledge(); return;
    }
    const del = event.target.closest('[data-delete-objective]');
    if (del) {
      if (!confirm('¿Eliminar este objetivo y todo su conocimiento estructurado? Las fuentes/versiones asociadas dejarán de pertenecer al objetivo.')) return;
      await window.nexa.knowledgeDb.deleteObjective(del.dataset.deleteObjective);
      const chat = currentChat(); if (chat) { chat.objectiveIds = (chat.objectiveIds || []).filter(function (id) { return id !== del.dataset.deleteObjective; }); await persistChat(chat); }
      await refreshPersistentKnowledge();
    }
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
  els.copyBridgeTokenBtn.addEventListener('click', copyBridgeToken);
  els.toggleBridgeTokenBtn.addEventListener('click', () => {
    const show = els.bridgeToken.type === 'password';
    els.bridgeToken.type = show ? 'text' : 'password';
    els.toggleBridgeTokenBtn.textContent = show ? 'Ocultar' : 'Mostrar';
  });
  els.regenerateBridgeTokenBtn.addEventListener('click', regenerateBridgeToken);

  window.nexa.chat.onToken(packet => { if (packet.requestId === state.activeRequestId) updateStreamingMessage(packet.content || ''); });
  window.nexa.chat.onContext(packet => { if (packet.requestId === state.activeRequestId) attachSources(packet.sources || []); });
  window.nexa.chat.onDone(packet => { if (packet.requestId === state.activeRequestId) finishGeneration(packet.stats).catch(error => finishWithError(error.message)); });
  window.nexa.chat.onError(packet => { if (packet.requestId === state.activeRequestId) finishWithError(packet.error || 'Error de generación.'); });
  if (window.nexa.images?.onProgress) window.nexa.images.onProgress(packet => {
    if (packet.requestId !== state.activeRequestId || state.activeRequestMode !== 'image') return;
    updateImageProgress(packet.label || 'Generando imagen…');
  });
  window.nexa.research.onProgress(packet => {
    els.researchProgress.hidden = false;
    if (packet.phase === 'search') { els.researchProgressText.textContent = 'Buscando fuentes: ' + (packet.topic || ''); els.researchProgressState.textContent = 'SEARCH'; }
    else if (packet.phase === 'validate') { els.researchProgressText.textContent = 'Validando ' + String(packet.sourceCount || 0) + ' fuente(s)…'; els.researchProgressState.textContent = 'VERIFY'; }
    else if (packet.phase === 'batch') { els.researchProgressText.textContent = 'Faltante ' + String(packet.current || 0) + '/' + String(packet.total || 0) + ': ' + (packet.topic || ''); els.researchProgressState.textContent = 'BATCH'; }
    else if (packet.phase === 'done') { els.researchProgressText.textContent = packet.saved ? 'Validado y guardado persistentemente' : 'Investigado; no se guardó como confirmado'; els.researchProgressState.textContent = packet.status || 'DONE'; }
    else if (packet.phase === 'error') { els.researchProgressText.textContent = packet.error || 'Error de investigación'; els.researchProgressState.textContent = 'ERROR'; }
  });
  if (window.nexa.factory?.onProgress) window.nexa.factory.onProgress(async packet => {
    els.factoryProgress.hidden = false;
    const phase=String(packet.phase || '').toUpperCase();
    els.factoryProgressState.textContent = phase || 'WORK';
    els.factoryProgressText.textContent = packet.message || packet.error || (packet.year ? ('Procesando ' + packet.year) : 'Auto Knowledge Factory trabajando…');
    if (['DISCOVERED','REFRESH','COMPLETE','ERROR'].includes(phase)) await refreshFactory();
    if (phase === 'COMPLETE') setTimeout(() => { els.factoryProgress.hidden=true; },2500);
  });
  if (window.nexa.bridge?.onCapture) window.nexa.bridge.onCapture(async packet => {
    if (packet?.type === 'knowledge') {
      toast('Conocimiento recibido desde Chrome y guardado localmente.','success');
      await refreshPersistentKnowledge();
    } else if (packet?.type === 'memory') {
      toast('Memoria recibida desde Chrome.','success');
      const snapshot = await window.nexa.store.get();
      state.memories = snapshot.memories || [];
      renderMemories();
    }
  });
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
  const initData = await Promise.all([window.nexa.store.get(), window.nexa.knowledge.list(), window.nexa.knowledgeDb.objectives(), window.nexa.knowledgeDb.stats(), window.nexa.factory?.list ? window.nexa.factory.list() : Promise.resolve([])]);
  const snapshot = initData[0]; const knowledge = initData[1];
  state.settings = snapshot.settings || {}; state.chats = snapshot.chats || []; state.memories = snapshot.memories || [];
  state.libraries = knowledge?.libraries || []; state.knowledgeRoot = knowledge?.root || snapshot.knowledgeDirectory || '';
  state.objectives = Array.isArray(initData[2]) ? initData[2] : []; state.knowledgeDbStats = initData[3] || null; state.factoryCurricula = Array.isArray(initData[4]) ? initData[4] : [];
  state.currentChatId = state.chats[0]?.id || null;
  els.versionLabel.textContent = `v${snapshot.appVersion || '1.7.0'}`; if (els.brandVersion) els.brandVersion.textContent = `v${snapshot.appVersion || '1.7.0'}`;
  fillSettings(); updateModeUi(); renderChats(); renderMemories(); renderPersistentKnowledge(); renderFactory(); renderLibraries(); renderCurrentChat(); resizePrompt(); updateScrollUi();
  els.objectiveAutomotiveFields.hidden = els.objectiveType.value !== 'automotive';
  await Promise.all([refreshStats(), refreshBridgeStatus()]);
  state.statsTimer = setInterval(refreshStats,2500);
  state.bridgeTimer = setInterval(refreshBridgeStatus,5000);
}

init().catch(error => {
  console.error(error);
  document.body.innerHTML = `<pre style="padding:24px;color:#ff9aa5">Nexa AI no pudo iniciar:\n${escapeHtml(error.stack || error.message || String(error))}</pre>`;
});
