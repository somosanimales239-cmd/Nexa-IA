'use strict';

(() => {
  if (window.__NEXA_CONVERSATION_TOOLS_V192__) return;
  window.__NEXA_CONVERSATION_TOOLS_V192__ = true;

  function installStyle() {
    if (document.getElementById('nexaConversationToolsStyleV192')) return;
    const style = document.createElement('style');
    style.id = 'nexaConversationToolsStyleV192';
    style.textContent = `
      .chat-rename-v192{border:0;background:transparent;color:inherit;opacity:.62;cursor:pointer;font-size:13px;padding:5px 4px;border-radius:6px;line-height:1}
      .chat-rename-v192:hover{opacity:1;background:rgba(255,255,255,.08)}
      .chat-rename-input-v192{width:100%;min-width:0;border:1px solid rgba(120,170,255,.55);background:rgba(4,9,18,.96);color:inherit;border-radius:7px;padding:4px 7px;font:inherit;outline:none}
      .chat-rename-input-v192:focus{border-color:rgba(120,170,255,.95);box-shadow:0 0 0 2px rgba(80,130,255,.12)}
    `;
    document.head.appendChild(style);
  }

  function decorate() {
    installStyle();
    const list = document.getElementById('chatList');
    if (!list) return;
    for (const row of list.querySelectorAll('.chat-item[data-chat-id]')) {
      if (row.querySelector('.chat-rename-v192')) continue;
      const deleteButton = row.querySelector('[data-delete-chat]');
      if (!deleteButton) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chat-rename-v192';
      button.dataset.renameChatV192 = row.dataset.chatId || '';
      button.title = 'Editar nombre de la conversación';
      button.setAttribute('aria-label', 'Editar nombre de la conversación');
      button.textContent = '✎';
      deleteButton.parentNode.insertBefore(button, deleteButton);
    }
  }

  function beginRename(chatId) {
    const safeId = CSS.escape(String(chatId || ''));
    let row = document.querySelector(`.chat-item[data-chat-id="${safeId}"]`);
    if (!row) return;

    if (!row.classList.contains('active')) {
      row.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    }

    requestAnimationFrame(() => {
      row = document.querySelector(`.chat-item[data-chat-id="${safeId}"]`);
      if (!row) return;
      const titleNode = row.querySelector('.chat-item-title');
      if (!titleNode || row.querySelector('.chat-rename-input-v192')) return;
      const original = String(titleNode.textContent || '').trim() || 'Nuevo chat';
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 120;
      input.className = 'chat-rename-input-v192';
      input.value = original;
      input.setAttribute('aria-label', 'Nombre de la conversación');
      titleNode.replaceWith(input);
      input.focus();
      input.select();

      let finished = false;
      const restore = value => {
        if (finished) return;
        finished = true;
        const finalName = String(value || original).trim().slice(0, 120) || original;
        const title = document.createElement('div');
        title.className = 'chat-item-title';
        title.title = finalName;
        title.textContent = finalName;
        if (input.isConnected) input.replaceWith(title);
      };
      const save = () => {
        if (finished) return;
        const newName = String(input.value || '').trim().slice(0, 120) || original;
        const topTitle = document.getElementById('chatTitle');
        if (topTitle) {
          topTitle.value = newName;
          topTitle.dispatchEvent(new Event('change', { bubbles:true }));
        }
        restore(newName);
      };
      const cancel = () => restore(original);

      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); save(); }
        else if (event.key === 'Escape') { event.preventDefault(); cancel(); }
      });
      input.addEventListener('blur', save, { once:true });
    });
  }

  function bind() {
    const list = document.getElementById('chatList');
    if (!list || list.dataset.renameBoundV192 === '1') return;
    list.dataset.renameBoundV192 = '1';
    list.addEventListener('click', event => {
      const button = event.target.closest('[data-rename-chat-v192]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      beginRename(button.dataset.renameChatV192);
    }, true);
    new MutationObserver(() => queueMicrotask(decorate)).observe(list, { childList:true, subtree:true });
  }

  function install() {
    decorate();
    bind();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
  let tries = 0;
  const timer = setInterval(() => { tries += 1; install(); if (tries > 30) clearInterval(timer); }, 400);
})();
