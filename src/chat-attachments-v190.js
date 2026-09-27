'use strict';

(function () {
  function ensureElements() {
    const composer = document.querySelector('#chatComposer') || document.querySelector('textarea') || document.body;
    if (!composer || document.getElementById('chatDropzoneV190')) return;

    const wrap = document.createElement('div');
    wrap.className = 'chat-attachment-toolbar';
    wrap.innerHTML = `
      <button type="button" id="attachFileBtnV190">Attach file</button>
      <input type="file" id="attachFileInputV190" multiple style="display:none" accept="image/*,.pdf,.txt,.md,.docx" />
    `;

    const drop = document.createElement('div');
    drop.id = 'chatDropzoneV190';
    drop.className = 'chat-dropzone';
    drop.textContent = 'Drag & drop images/documents here, or paste directly into chat.';

    const list = document.createElement('div');
    list.id = 'chatAttachmentListV190';
    list.className = 'chat-attachment-list';

    composer.parentNode.insertBefore(wrap, composer.nextSibling);
    composer.parentNode.insertBefore(drop, wrap.nextSibling);
    composer.parentNode.insertBefore(list, drop.nextSibling);

    document.getElementById('attachFileBtnV190').addEventListener('click', () => {
      document.getElementById('attachFileInputV190').click();
    });

    document.getElementById('attachFileInputV190').addEventListener('change', (event) => {
      const files = Array.from(event.target.files || []);
      window.NexaChatAttachmentsV190.addFiles(files);
    });

    ['dragenter','dragover'].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.add('dragover');
      });
    });

    ['dragleave','drop'].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.remove('dragover');
      });
    });

    drop.addEventListener('drop', (e) => {
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      window.NexaChatAttachmentsV190.addFiles(files);
    });

    document.addEventListener('paste', async (e) => {
      const items = Array.from((e.clipboardData && e.clipboardData.items) || []);
      const files = [];
      for (const item of items) {
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        window.NexaChatAttachmentsV190.addFiles(files);
      }
    });
  }

  const state = {
    files: [],
  };

  function renderList() {
    const list = document.getElementById('chatAttachmentListV190');
    if (!list) return;
    list.innerHTML = '';
    state.files.forEach((file) => {
      const pill = document.createElement('div');
      pill.className = 'chat-attachment-pill';
      pill.textContent = file.name || 'attachment';
      list.appendChild(pill);
    });
  }

  function addFiles(files) {
    state.files.push(...files.slice(0, 10));
    renderList();
  }

  function getFiles() {
    return state.files.slice();
  }

  window.NexaChatAttachmentsV190 = {
    ensureElements,
    addFiles,
    getFiles,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureElements);
  } else {
    ensureElements();
  }
})();
