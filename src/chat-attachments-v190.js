(() => {
  'use strict';
  if (window.__NEXA_CHAT_ATTACHMENTS_V190) return;
  window.__NEXA_CHAT_ATTACHMENTS_V190 = true;

  const MAX_FILES = 8;
  const MAX_BYTES = 15 * 1024 * 1024;
  const pending = [];
  let bypassSendCapture = false;
  let forceImageForNextSend = false;

  const $ = selector => document.querySelector(selector);
  const prompt = () => document.getElementById('promptInput');
  const sendButton = () => document.getElementById('sendBtn');

  function style() {
    if (document.getElementById('nexaAttachStyleV190')) return;
    const node = document.createElement('style');
    node.id = 'nexaAttachStyleV190';
    node.textContent = `
      #nexaReferenceV188{display:none!important}
      .composer{position:relative!important}
      #nexaAttachmentTray{display:none;gap:8px;flex-wrap:wrap;padding:8px 8px 2px 8px;align-items:center;grid-column:1/-1}
      #nexaAttachmentTray.has-items{display:flex}
      .nexa-att-chip{position:relative;display:flex;align-items:center;gap:7px;max-width:220px;background:#111d30;border:1px solid #263957;border-radius:11px;padding:6px 28px 6px 7px;color:#dce8ff;font-size:11px}
      .nexa-att-chip img{width:42px;height:42px;object-fit:cover;border-radius:8px;background:#0a1220}
      .nexa-att-doc{width:42px;height:42px;border-radius:8px;display:grid;place-items:center;background:#17253b;font-size:18px}
      .nexa-att-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px}
      .nexa-att-remove{position:absolute;right:5px;top:5px;width:18px;height:18px;border:0;border-radius:50%;background:#293b58;color:white;cursor:pointer;line-height:16px;padding:0}
      #nexaAttachBtn{width:31px;height:31px;border-radius:9px;border:1px solid #2a3b55;background:#111d30;color:#d9e5f7;cursor:pointer;font-size:19px;display:grid;place-items:center;padding:0;margin-right:5px}
      #nexaAttachBtn:hover{transform:translateY(-1px);border-color:#86a7d4;background:#17263d}
      #nexaDropOverlay{position:absolute;inset:5px;border:1px dashed #8eb8ff;border-radius:13px;background:rgba(11,24,43,.94);display:none;z-index:30;align-items:center;justify-content:center;text-align:center;color:#dfeaff;font-size:13px;pointer-events:none}
      #nexaDropOverlay.show{display:flex}
      .nexa-att-hint{font-size:10px;opacity:.65;margin-left:4px}
      .nexa-sent-attachments{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 2px 0;max-width:680px}
      .nexa-sent-image{width:132px;height:96px;object-fit:cover;border-radius:10px;border:1px solid #2b3d59;background:#0b1321}
      .nexa-sent-doc{display:flex;align-items:center;gap:8px;max-width:260px;padding:8px 10px;border-radius:10px;border:1px solid #2b3d59;background:#101a2a;color:#dce8ff;font-size:11px}
      .nexa-sent-doc span{font-size:18px}
      .nexa-sent-doc b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
    `;
    document.head.appendChild(node);
  }

  function toast(message) {
    const host = document.getElementById('toastHost');
    if (host) {
      const node = document.createElement('div');
      node.className = 'toast';
      node.textContent = message;
      host.appendChild(node);
      setTimeout(() => node.remove(), 3500);
      return;
    }
    console.log('[Nexa Attachments]', message);
  }

  function fileKind(file) {
    const name = String(file?.name || '').toLowerCase();
    const type = String(file?.type || '').toLowerCase();
    if (type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(name)) return 'image';
    if (/\.(pdf|txt|md|docx|csv|json)$/i.test(name)) return 'document';
    return 'other';
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
      reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.readAsDataURL(file);
    });
  }

  function imageToReference(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('No se pudo leer la imagen.'));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('Imagen inválida.'));
        image.onload = () => {
          const max = 1400;
          const scale = Math.min(1, max / Math.max(image.width, image.height));
          const width = Math.max(1, Math.round(image.width * scale));
          const height = Math.max(1, Math.round(image.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          canvas.getContext('2d').drawImage(image, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
          resolve({ name:file.name || 'image.jpg', type:'image/jpeg', size:file.size || 0, width, height, data:dataUrl.split(',')[1] || '', preview:dataUrl, kind:'image' });
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function normalizeFile(file) {
    if (!file) return null;
    if (Number(file.size || 0) > MAX_BYTES) throw new Error(`${file.name || 'El archivo'} supera 15 MB.`);
    const kind = fileKind(file);
    if (kind === 'other') throw new Error(`Tipo no soportado: ${file.name || 'archivo'}`);
    if (kind === 'image') return imageToReference(file);
    return { name:file.name || 'documento', type:file.type || 'application/octet-stream', size:file.size || 0, data:await fileToBase64(file), preview:'', kind:'document' };
  }

  function renderTray() {
    const tray = document.getElementById('nexaAttachmentTray');
    if (!tray) return;
    tray.innerHTML = '';
    tray.classList.toggle('has-items', pending.length > 0);
    pending.forEach((item, index) => {
      const chip = document.createElement('div');
      chip.className = 'nexa-att-chip';
      if (item.kind === 'image') {
        const img = document.createElement('img'); img.src = item.preview; img.alt = item.name; chip.appendChild(img);
      } else {
        const icon = document.createElement('div'); icon.className = 'nexa-att-doc'; icon.textContent = '📄'; chip.appendChild(icon);
      }
      const label = document.createElement('span'); label.className = 'nexa-att-name'; label.textContent = item.name; chip.appendChild(label);
      const remove = document.createElement('button'); remove.type='button'; remove.className='nexa-att-remove'; remove.textContent='×';
      remove.addEventListener('click', () => { pending.splice(index,1); renderTray(); });
      chip.appendChild(remove); tray.appendChild(chip);
    });
  }

  async function addFiles(files) {
    const list = Array.from(files || []).slice(0, Math.max(0, MAX_FILES - pending.length));
    for (const file of list) {
      try { const normalized = await normalizeFile(file); if (normalized) pending.push(normalized); }
      catch (error) { toast(error.message || String(error)); }
    }
    renderTray(); prompt()?.focus();
  }

  function clearPending() { pending.splice(0,pending.length); renderTray(); }

  function wantsReference(value) {
    const source = String(value || '');
    return /(mismo|misma|same|parecid|similar|referencia|reference|consisten|igual\s+a|usa\s+esta\s+(imagen|foto)|use\s+this\s+image|mismo\s+estilo|same\s+style|basad[oa]\s+en|based\s+on|a\s+partir\s+de|con\s+esta\s+(imagen|foto)|como\s+esta\s+(imagen|foto)|mant[eé]n|manteniendo|conserva|preserva|identidad|este\s+(perro|perrito|gato|personaje)|esta\s+(perrita|gata|imagen|foto)|this\s+(dog|puppy|cat|character|image|photo)|el\s+de\s+la\s+(foto|imagen)|la\s+de\s+la\s+(foto|imagen))/i.test(source);
  }

  function isVisualQuestion(value) {
    return /(qu[eé]\s+ves|que\s+hay|describe|descr[ií]be|analiza\s+(esta|la)\s+(imagen|foto)|what\s+do\s+you\s+see|describe\s+this|what\s+is\s+in|cu[aá]ntos?|count|lee\s+el\s+texto|read\s+the\s+text|compara|compare|se\s+parece|does\s+it\s+look\s+like)/i.test(String(value || ''));
  }

  function explicitImageRequest(value) {
    const source = String(value || '').trim();
    return /(genera|generame|generate|create|crear|crea|haz|hazme|make|draw|render|dibuja|imagina|quiero|necesito|mu[eé]strame).{0,45}(imagen|image|photo|picture|foto|render|illustration|ilustraci[oó]n|portrait|retrato)/i.test(source)
      || /(imagen|image|photo|picture|foto).{0,22}(de|of)\b/i.test(source);
  }

  function naturalReferenceGeneration(value) {
    const source = String(value || '').trim();
    if (!pending.some(item => item.kind === 'image') || !source) return false;
    if (isVisualQuestion(source) && !/(haz|crea|genera|pon|cambia|convierte|transforma|make|create|generate|turn|change)/i.test(source)) return false;
    if (explicitImageRequest(source)) return true;
    const editVerb = /(haz|hazlo|crea|genera|ponlo|ponla|pon\s+|cambia|c[aá]mbialo|convierte|transforma|dibuja|renderiza|make|create|generate|put\s+it|change|turn\s+it|transform)/i.test(source);
    const sceneChange = /(pero|ahora|jugando|corriendo|saltando|en\s+un\s+(parque|bosque|hotel|carro|auto|escena|lugar)|en\s+una\s+(playa|calle|casa|escena)|con\s+\d+\s+|with\s+\d+\s+|playing|running|jumping|at\s+the\s+|in\s+a\s+)/i.test(source);
    const visualSubject = /(perro|perrito|perrita|gato|gata|personaje|persona|carro|auto|producto|dog|puppy|cat|character|person|car|product|estilo|style)/i.test(source);
    const deicticReference = /(esta\s+(foto|imagen)|este\s+(perro|perrito|gato|personaje|objeto)|this\s+(photo|image|dog|puppy|cat|character|object)|el\s+de\s+la\s+(foto|imagen)|la\s+de\s+la\s+(foto|imagen))/i.test(source);
    return wantsReference(source) && (visualSubject || deicticReference) && (editVerb || sceneChange);
  }

  function installNaturalImageDetector() {
    try {
      const previous = typeof looksLikeImageRequest === 'function' ? looksLikeImageRequest : window.looksLikeImageRequest;
      if (typeof previous !== 'function' || previous.__nexaV190) return typeof previous === 'function';
      const patched = function(value) {
        if (forceImageForNextSend) return true;
        if (previous(value)) return true;
        return naturalReferenceGeneration(value);
      };
      patched.__nexaV190 = true;
      window.looksLikeImageRequest = patched;
      try { looksLikeImageRequest = patched; } catch (_) {}
      return true;
    } catch (_) { return false; }
  }

  function encodeToken(token) {
    let bits='';
    for (const ch of String(token || '')) {
      const n=ch.charCodeAt(0);
      for (let bit=7; bit>=0; bit--) bits += ((n >> bit) & 1) ? '\u200C' : '\u200B';
    }
    return '\u2063\u2063' + bits + '\u2064\u2064';
  }

  function fileUrl(filePath) {
    let value = String(filePath || '').replace(/\\/g,'/');
    if (!value) return '';
    if (/^file:\/\//i.test(value)) return encodeURI(value);
    while (value.startsWith('/')) value = value.slice(1);
    return encodeURI('file:///' + value);
  }

  function parseAttachmentSource(source) {
    if (!source || source.sourceType !== 'chat_attachment') return null;
    let meta={}; try { meta=JSON.parse(source.citation || '{}'); } catch (_) {}
    return { name:source.documentName || 'attachment', path:source.path || '', kind:meta.kind || 'document', mime:meta.mime || '', size:Number(meta.size || 0) };
  }

  function currentAttachmentMessages() {
    try {
      const chat = typeof currentChat === 'function' ? currentChat() : null;
      return Array.isArray(chat?.messages) ? chat.messages : [];
    } catch (_) { return []; }
  }

  function buildSentAttachments(items) {
    const host = document.createElement('div'); host.className='nexa-sent-attachments';
    for (const item of items) {
      if (item.kind === 'image') {
        const img=document.createElement('img'); img.className='nexa-sent-image'; img.alt=item.name; img.title=item.name; img.src=item.preview || fileUrl(item.path); host.appendChild(img);
      } else {
        const doc=document.createElement('div'); doc.className='nexa-sent-doc';
        const icon=document.createElement('span'); icon.textContent='📄';
        const label=document.createElement('b'); label.textContent=item.name;
        doc.append(icon,label); host.appendChild(doc);
      }
    }
    return host;
  }

  function decoratePersistedAttachments() {
    const messages = currentAttachmentMessages();
    for (const message of messages) {
      const items=(message.sources || []).map(parseAttachmentSource).filter(Boolean);
      if (!items.length) continue;
      const article=document.querySelector(`[data-message-id="${CSS.escape(String(message.id || ''))}"]`);
      if (!article || article.querySelector('.nexa-sent-attachments')) continue;
      const body=article.querySelector('.message-content');
      if (body) body.insertAdjacentElement('beforebegin', buildSentAttachments(items));
    }
  }

  function decorateLatestUserSnapshot(items) {
    if (!items?.length) return;
    setTimeout(() => {
      const users=Array.from(document.querySelectorAll('.message.user'));
      const article=users[users.length-1];
      if (!article || article.querySelector('.nexa-sent-attachments')) return;
      const body=article.querySelector('.message-content');
      if (body) body.insertAdjacentElement('beforebegin', buildSentAttachments(items));
    },0);
  }

  async function stageAndSend() {
    if (!pending.length || !window.nexa?.attachments?.stage) return false;
    const input=prompt(); if (!input) return false;
    let userText=input.value.trim();
    const hasImage=pending.some(item => item.kind==='image');
    const hasDoc=pending.some(item => item.kind==='document');
    if (!userText) userText=hasImage ? 'Describe esta imagen.' : (hasDoc ? 'Resume y explícame este documento.' : 'Analiza estos adjuntos.');
    const snapshot=pending.map(item => ({ name:item.name, kind:item.kind, preview:item.preview || '', path:'' }));
    const staged=await window.nexa.attachments.stage({ files:pending.map(item => ({ name:item.name, type:item.type, size:item.size, data:item.data })) });
    if (!staged?.ok || !staged?.token) throw new Error('No se pudieron preparar los adjuntos.');
    input.value=userText + encodeToken(staged.token);
    forceImageForNextSend=explicitImageRequest(userText) || naturalReferenceGeneration(userText);
    bypassSendCapture=true;
    try { sendButton()?.click(); decorateLatestUserSnapshot(snapshot); }
    finally { bypassSendCapture=false; forceImageForNextSend=false; clearPending(); }
    return true;
  }

  function installUi() {
    style();
    const composer=$('.composer'), actions=$('.composer-actions'), input=prompt();
    if (!composer || !actions || !input) return false;
    if (document.getElementById('nexaAttachBtn')) return true;

    const tray=document.createElement('div'); tray.id='nexaAttachmentTray'; composer.insertBefore(tray,input);
    const button=document.createElement('button'); button.id='nexaAttachBtn'; button.type='button'; button.title='Adjuntar imagen o documento'; button.setAttribute('aria-label','Adjuntar imagen o documento'); button.textContent='+';
    const picker=document.createElement('input'); picker.id='nexaAttachPicker'; picker.type='file'; picker.multiple=true; picker.accept='image/png,image/jpeg,image/webp,.pdf,.txt,.md,.docx,.csv,.json'; picker.style.display='none'; document.body.appendChild(picker);
    button.addEventListener('click',()=>picker.click());
    picker.addEventListener('change',async()=>{ await addFiles(picker.files); picker.value=''; });
    actions.insertBefore(button,actions.firstChild);

    const overlay=document.createElement('div'); overlay.id='nexaDropOverlay'; overlay.innerHTML='<div><strong>Suelta aquí</strong><br><span class="nexa-att-hint">Imágenes, PDF, DOCX, TXT, MD, CSV o JSON</span></div>'; composer.appendChild(overlay);
    let dragDepth=0;
    composer.addEventListener('dragenter',event=>{event.preventDefault();dragDepth++;overlay.classList.add('show');});
    composer.addEventListener('dragover',event=>event.preventDefault());
    composer.addEventListener('dragleave',event=>{event.preventDefault();dragDepth--;if(dragDepth<=0){dragDepth=0;overlay.classList.remove('show');}});
    composer.addEventListener('drop',async event=>{event.preventDefault();dragDepth=0;overlay.classList.remove('show');await addFiles(event.dataTransfer?.files || []);});

    input.addEventListener('paste',async event=>{
      const items=Array.from(event.clipboardData?.items || []);
      const files=items.filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);
      if (!files.length) return;
      event.preventDefault(); await addFiles(files);
    },true);

    document.addEventListener('click',async event=>{
      if (bypassSendCapture || event.target !== sendButton() || !pending.length) return;
      event.preventDefault(); event.stopImmediatePropagation();
      try { await stageAndSend(); } catch (error) { toast(error.message || String(error)); }
    },true);

    document.addEventListener('keydown',async event=>{
      if (bypassSendCapture || event.target !== prompt() || event.key!=='Enter' || event.shiftKey || !pending.length) return;
      event.preventDefault(); event.stopImmediatePropagation();
      try { await stageAndSend(); } catch (error) { toast(error.message || String(error)); }
    },true);

    const messages=document.getElementById('messages');
    if (messages) new MutationObserver(()=>decoratePersistedAttachments()).observe(messages,{childList:true,subtree:true});
    renderTray(); decoratePersistedAttachments();
    return true;
  }

  let attempts=0;
  const timer=setInterval(()=>{
    attempts++;
    const ui=installUi();
    const detector=installNaturalImageDetector();
    const oldPanel=document.getElementById('nexaReferenceV188'); if(oldPanel) oldPanel.style.display='none';
    decoratePersistedAttachments();
    if (ui && detector && attempts>4) clearInterval(timer);
    if (attempts>40) clearInterval(timer);
  },300);
})();
