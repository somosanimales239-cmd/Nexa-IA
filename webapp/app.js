'use strict';

const state = {
  token:'',
  bootstrap:null,
  chats:[],
  memories:[],
  currentChatId:null,
  pendingFiles:[],
  activeRequestId:'',
  activeAbort:null,
  forgePoll:null,
  currentImage:null,
};

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const els = {};

function uid(prefix='id'){ return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`; }
function escapeHtml(v){ return String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function toast(message,type=''){ const n=document.createElement('div'); n.className=`toast ${type}`; n.textContent=message; $('#toastHost').appendChild(n); setTimeout(()=>n.remove(),4200); }
function fmtTime(iso){ try{return new Intl.DateTimeFormat('es',{hour:'2-digit',minute:'2-digit'}).format(new Date(iso));}catch(_){return '';} }
function compact(v,max=120){ const s=String(v||'').replace(/\s+/g,' ').trim(); return s.length>max?s.slice(0,max-1)+'…':s; }
function currentChat(){ return state.chats.find(x=>x.id===state.currentChatId)||null; }

async function getSession(){
  const r=await fetch('/api/session',{cache:'no-store'}); const j=await r.json();
  if(!j.ok) throw new Error(j.error||'No pude abrir sesión web.');
  state.token=j.token; $('#versionText').textContent=j.version||'2.0.0';
}
async function api(route,{method='GET',body=null,signal=null}={}){
  const opt={method,headers:{'X-Nexa-Web-Token':state.token},signal};
  if(body!==null){ opt.headers['Content-Type']='application/json'; opt.body=JSON.stringify(body); }
  const r=await fetch(route,opt); const text=await r.text(); let j={};
  try{j=text?JSON.parse(text):{};}catch(_){throw new Error(text||`HTTP ${r.status}`);}
  if(!r.ok||j.ok===false) throw new Error(j.error||`HTTP ${r.status}`);
  return j;
}

function cache(){
  const ids=['backendDot','backendText','forgeDot','forgeText','chatList','chatTitle','chatMeta','messages','chatStatus','attachmentTray','fileInput','promptInput','sendBtn','stopChatBtn','newChatBtn','deleteChatBtn','forgeModelBadge','forgeProgressBadge','imagePrompt','imageNegative','forgeModelSelect','forgeSamplerSelect','forgeSchedulerSelect','forgeUpscalerSelect','forgeHiresSelect','imagePreset','imageSteps','imageCfg','imageDenoise','imageSeed','imageHires','imageHiresScale','generateImageBtn','interruptImageBtn','imageEmpty','imagePreview','imageInfo','downloadImageLink','knowledgeQuery','knowledgeSearchBtn','knowledgeResults','librariesList','objectivesList','memoryText','saveMemoryBtn','memoryList','systemNexa','systemOllama','systemForge','systemStats','refreshForgeBtn','webSettingsForm','forgeBaseUrl','defaultSteps','defaultCfg','defaultHiresScale','defaultDenoise','autoOpenWeb','minimizeDesktop','testForgeBtn','forgeTestResult'];
  for(const id of ids) els[id]=$(`#${id}`);
}
function setView(name){
  $$('#mainNav button').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  $$('[data-view-panel]').forEach(p=>p.classList.toggle('active',p.dataset.viewPanel===name));
}
function setDot(el,mode){ el.classList.remove('online','warn'); if(mode)el.classList.add(mode); }

function renderChats(){
  if(!state.chats.length){ els.chatList.innerHTML='<div class="list-item"><small>No hay conversaciones.</small></div>'; return; }
  els.chatList.innerHTML=state.chats.map(chat=>`<div class="chat-item ${chat.id===state.currentChatId?'active':''}" data-chat-id="${escapeHtml(chat.id)}"><strong>${escapeHtml(chat.title||'Nuevo chat')}</strong><small>${escapeHtml(chat.updatedAt?new Date(chat.updatedAt).toLocaleString():'')}</small></div>`).join('');
  $$('.chat-item').forEach(n=>n.addEventListener('click',()=>{state.currentChatId=n.dataset.chatId; renderChats(); renderCurrentChat();}));
}
function renderCurrentChat(){
  const chat=currentChat();
  els.chatTitle.textContent=chat?.title||'Nuevo chat';
  els.chatMeta.textContent=chat?`${chat.messages?.length||0} mensajes · Nexa local`:'Nexa local';
  if(!chat||!chat.messages?.length){els.messages.innerHTML='<div class="empty-preview" style="height:100%"><div class="big-icon">N</div><strong>Nexa AI Web</strong><span>Chat local + Forge en una sola página.</span></div>';return;}
  els.messages.innerHTML=chat.messages.map(m=>{
    const image=m.image?.url||m.image?.imageUrl||(m.image?.fileName?`/generated/${encodeURIComponent(m.image.fileName)}`:'');
    const source=image?`<img class="generated" src="${escapeHtml(image)}" alt="generated"/>`:'';
    return `<article class="message ${m.role==='user'?'user':'assistant'}"><div class="meta">${m.role==='user'?'Tú':'Nexa AI'} · ${fmtTime(m.createdAt)}</div><div class="bubble">${escapeHtml(m.content||'')}${source}</div></article>`;
  }).join('');
  els.messages.scrollTop=els.messages.scrollHeight;
}
async function saveChat(chat,attachmentToken=''){
  const j=await api('/api/chat/save',{method:'POST',body:{chat,attachmentToken}});
  const idx=state.chats.findIndex(x=>x.id===j.chat.id); if(idx>=0)state.chats[idx]=j.chat; else state.chats.unshift(j.chat);
  state.currentChatId=j.chat.id; renderChats(); return j.chat;
}
function newChat(){
  const chat={id:uid('chat'),title:'Nuevo chat',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),libraryIds:[],objectiveIds:[],messages:[]};
  state.chats.unshift(chat); state.currentChatId=chat.id; renderChats(); renderCurrentChat(); els.promptInput.focus();
}
async function deleteCurrentChat(){
  const chat=currentChat(); if(!chat)return;
  await api('/api/chat/delete',{method:'POST',body:{id:chat.id}}); state.chats=state.chats.filter(x=>x.id!==chat.id); state.currentChatId=state.chats[0]?.id||null; renderChats(); renderCurrentChat();
}
function autoTitle(chat,text){ if(!chat||chat.title!=='Nuevo chat')return; chat.title=compact(text,54)||'Nuevo chat'; }

function looksLikeImageRequest(value){
  const s=String(value||'').trim(); if(!s)return false;
  if(/^\/(image|img)\b/i.test(s))return true;
  if(/\b(prompt|promt)\b/i.test(s)&&!/(genera|crea|haz|make|generate|draw|render).{0,30}(imagen|image|foto|photo)/i.test(s))return false;
  return /(genera(?:me)?|crea(?:me)?|haz(?:me)?|generate|create|make|draw|dibuja|renderiza|render).{0,70}(imagen|image|foto|photo|picture|ilustraci[oó]n|render|personaje|character|logo|poster)/i.test(s)
    || /(imagen|image|foto|photo).{0,25}(de|of)\b/i.test(s);
}

async function fileToPayload(file){
  if(file.size>15*1024*1024)throw new Error(`${file.name} supera 15 MB.`);
  return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(r.error||new Error('No se pudo leer archivo.'));r.onload=()=>resolve({name:file.name,type:file.type||'',data:String(r.result||'').split(',')[1]||''});r.readAsDataURL(file);});
}
function renderAttachments(){
  els.attachmentTray.innerHTML=state.pendingFiles.map((f,i)=>`<div class="attachment-chip"><span>📎 ${escapeHtml(f.name)}</span><button data-remove-att="${i}">×</button></div>`).join('');
  $$('[data-remove-att]').forEach(b=>b.addEventListener('click',()=>{state.pendingFiles.splice(Number(b.dataset.removeAtt),1);renderAttachments();}));
}
async function stageAttachments(){
  if(!state.pendingFiles.length)return '';
  const files=[]; for(const f of state.pendingFiles)files.push(await fileToPayload(f));
  const staged=await api('/api/attachments/stage',{method:'POST',body:{files}}); return staged.token||'';
}

function parseSseChunk(buffer,onEvent){
  let index; while((index=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,index);buffer=buffer.slice(index+2);let event='message',data='';for(const line of block.split('\n')){if(line.startsWith('event:'))event=line.slice(6).trim();else if(line.startsWith('data:'))data+=line.slice(5).trim();}let payload={};try{payload=data?JSON.parse(data):{};}catch(_){payload={raw:data};}onEvent(event,payload);}return buffer;
}
async function streamChat(chat,attachmentToken=''){
  const requestId=uid('webreq'); state.activeRequestId=requestId; state.activeAbort=new AbortController();
  els.sendBtn.disabled=true; els.stopChatBtn.classList.remove('hidden'); els.chatStatus.classList.remove('hidden'); els.chatStatus.textContent='Nexa está pensando…';
  const assistant={id:uid('msg'),role:'assistant',kind:'text',content:'',createdAt:new Date().toISOString(),sources:[]}; chat.messages.push(assistant); renderCurrentChat();
  const body={requestId,attachmentToken,payload:{requestId,libraryIds:chat.libraryIds||[],objectiveIds:chat.objectiveIds||[],messages:chat.messages.filter(x=>x.id!==assistant.id).map(x=>({role:x.role,content:x.content}))}};
  try{
    const r=await fetch('/api/chat/stream',{method:'POST',headers:{'Content-Type':'application/json','X-Nexa-Web-Token':state.token},body:JSON.stringify(body),signal:state.activeAbort.signal});
    if(!r.ok)throw new Error(await r.text()); const reader=r.body.getReader();const dec=new TextDecoder();let buf='';let done=false;
    const onEvent=(event,p)=>{
      if(event==='chat.token'){assistant.content=p.content||assistant.content;renderCurrentChat();}
      else if(event==='chat.context'){assistant.sources=p.sources||[];}
      else if(event==='chat.error'){assistant.content=`Error local: ${p.error||'Error de generación.'}`;done=true;}
      else if(event==='chat.done'){done=true;}
      els.chatStatus.textContent=event==='chat.token'?'Nexa está respondiendo…':event.replace('chat.','');
    };
    while(true){const part=await reader.read();if(part.done)break;buf+=dec.decode(part.value,{stream:true});buf=parseSseChunk(buf,onEvent);} if(!done&& !assistant.content)assistant.content='(La respuesta terminó sin contenido.)';
    await saveChat(chat); renderCurrentChat();
  }finally{
    state.activeRequestId='';state.activeAbort=null;els.sendBtn.disabled=false;els.stopChatBtn.classList.add('hidden');els.chatStatus.classList.add('hidden');
  }
}

function forgeFormBody(promptOverride=''){
  return {
    prompt:promptOverride||els.imagePrompt.value.trim(),negativePrompt:els.imageNegative.value.trim(),model:els.forgeModelSelect.value,sampler:els.forgeSamplerSelect.value,scheduler:els.forgeSchedulerSelect.value,upscaler:els.forgeUpscalerSelect.value,hiresUpscaler:els.forgeHiresSelect.value,preset:els.imagePreset.value,steps:Number(els.imageSteps.value),cfg:Number(els.imageCfg.value),denoise:Number(els.imageDenoise.value),seed:Number(els.imageSeed.value),hiresFix:els.imageHires.checked,hiresScale:Number(els.imageHiresScale.value),fourK:els.imagePreset.value.startsWith('4k-')
  };
}
async function startForgePolling(){
  clearInterval(state.forgePoll); state.forgePoll=setInterval(async()=>{try{const p=await api('/api/forge/progress');const pct=Math.round((Number(p.progress)||0)*100);els.forgeProgressBadge.textContent=pct?`${pct}% · ETA ${Math.round(Number(p.eta_relative)||0)}s`:'working';}catch(_){}},1800);
}
function stopForgePolling(){clearInterval(state.forgePoll);state.forgePoll=null;els.forgeProgressBadge.textContent='idle';}
async function generateForge(body,fromChat=false){
  els.generateImageBtn.disabled=true; els.forgeProgressBadge.textContent='starting'; startForgePolling();
  try{
    const result=await api('/api/forge/generate',{method:'POST',body}); state.currentImage=result;
    if(!fromChat){els.imageEmpty.classList.add('hidden');els.imagePreview.classList.remove('hidden');els.imagePreview.src=result.imageUrl;els.imageInfo.classList.remove('hidden');els.imageInfo.textContent=`${result.width}×${result.height} · ${result.stage}\nModel: ${result.model||'actual'}\nSampler: ${result.sampler||'-'} · Scheduler: ${result.scheduler||'-'}\nUpscaler: ${result.upscaler||'-'}\nTiempo: ${result.elapsedSeconds}s`;els.downloadImageLink.classList.remove('hidden');els.downloadImageLink.href=result.imageUrl;els.downloadImageLink.download=result.fileName||'nexa-forge.png';}
    toast(`Imagen lista ${result.width}×${result.height}`,'success'); return result;
  }finally{els.generateImageBtn.disabled=false;stopForgePolling();}
}
async function generateImageFromChat(chat,text,attachmentToken=''){
  const assistant={id:uid('msg'),role:'assistant',kind:'image',content:'Generando con Forge…',createdAt:new Date().toISOString(),image:null,sources:[]};chat.messages.push(assistant);renderCurrentChat();
  try{const result=await generateForge(forgeFormBody(text),true);assistant.content=`Imagen generada con Forge · ${result.width}×${result.height} · ${result.model||'modelo actual'}`;assistant.image={url:result.imageUrl,imageUrl:result.imageUrl,path:result.path||'',fileName:result.fileName,width:result.width,height:result.height,style:'forge'};await saveChat(chat,attachmentToken);renderCurrentChat();}
  catch(error){assistant.content=`Error Forge: ${error.message||error}`;await saveChat(chat).catch(()=>{});renderCurrentChat();toast(error.message||String(error),'error');}
}

async function send(){
  const text=els.promptInput.value.trim();if(!text||state.activeRequestId)return;let chat=currentChat();if(!chat){newChat();chat=currentChat();}
  const user={id:uid('msg'),role:'user',kind:'text',content:text,createdAt:new Date().toISOString(),sources:[]};chat.messages.push(user);autoTitle(chat,text);els.promptInput.value='';
  let token='';try{token=await stageAttachments();chat=await saveChat(chat,token);state.pendingFiles=[];renderAttachments();renderCurrentChat();if(looksLikeImageRequest(text)){await generateImageFromChat(chat,text,token);}else await streamChat(chat,token);}catch(error){toast(error.message||String(error),'error');}
}
async function stopActive(){
  if(state.activeAbort){state.activeAbort.abort();}
  if(state.activeRequestId)await api('/api/chat/stop',{method:'POST',body:{requestId:state.activeRequestId}}).catch(()=>{});
  state.activeRequestId='';els.stopChatBtn.classList.add('hidden');els.sendBtn.disabled=false;els.chatStatus.classList.add('hidden');
}

function fillSelect(el,items,value,mapper=x=>typeof x==='string'?x:(x.name||x.label||x.title||'')){
  const rows=(items||[]).map(mapper).filter(Boolean);el.innerHTML='<option value="">Auto / actual</option>'+rows.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');if(value&&rows.includes(value))el.value=value;
}
function applyForgeSnapshot(forge,config){
  const online=!!forge?.ok;setDot(els.forgeDot,online?'online':'warn');els.forgeText.textContent=online?'Forge online':'Forge offline';
  fillSelect(els.forgeModelSelect,forge?.models||[],config?.forgeModel,x=>x.title||x.model_name||'');
  fillSelect(els.forgeSamplerSelect,forge?.samplers||[],config?.forgeSampler,x=>x.name||'');
  fillSelect(els.forgeSchedulerSelect,forge?.schedulers||[],config?.forgeScheduler,x=>x.label||x.name||'');
  fillSelect(els.forgeUpscalerSelect,forge?.upscalers||[],config?.forgeUpscaler,x=>x.name||'');
  fillSelect(els.forgeHiresSelect,forge?.latentModes||[],config?.forgeHiresUpscaler,x=>x.name||String(x));
  els.forgeModelBadge.textContent=forge?.options?.sd_model_checkpoint||config?.forgeModel||'sin modelo';
}
function renderMemory(){
  els.memoryList.innerHTML=state.memories.length?state.memories.map(m=>`<div class="memory-item"><div>${escapeHtml(m.text)}</div><button class="ghost danger" data-del-memory="${escapeHtml(m.id)}">Eliminar</button></div>`).join(''):'<div class="list-item"><small>No hay recuerdos.</small></div>';
  $$('[data-del-memory]').forEach(b=>b.addEventListener('click',async()=>{await api('/api/memory/delete',{method:'POST',body:{id:b.dataset.delMemory}});state.memories=state.memories.filter(x=>x.id!==b.dataset.delMemory);renderMemory();}));
}
function renderKnowledge(){
  const libs=state.bootstrap?.knowledge?.libraries||[];els.librariesList.innerHTML=libs.length?libs.map(x=>`<div class="list-item"><strong>${escapeHtml(x.name||x.id||'Librería')}</strong><small>${escapeHtml(x.description||'')}</small></div>`).join(''):'<div class="list-item"><small>Sin librerías.</small></div>';
  const obs=state.bootstrap?.objectives||[];els.objectivesList.innerHTML=obs.length?obs.map(x=>`<div class="list-item"><strong>${escapeHtml(x.name||x.id||'Objetivo')}</strong><small>${escapeHtml(x.type||'')}</small></div>`).join(''):'<div class="list-item"><small>Sin objetivos.</small></div>';
}
function renderSystem(){
  const b=state.bootstrap||{};els.systemNexa.innerHTML=`<pre>${escapeHtml(JSON.stringify(b.web||{},null,2))}</pre>`;els.systemOllama.innerHTML=`<pre>${escapeHtml(JSON.stringify(b.engine||{},null,2))}</pre>`;els.systemForge.innerHTML=`<pre>${escapeHtml(JSON.stringify({ok:b.forge?.ok,baseUrl:b.forge?.baseUrl,model:b.forge?.options?.sd_model_checkpoint,error:b.forge?.error},null,2))}</pre>`;els.systemStats.innerHTML=`<pre>${escapeHtml(JSON.stringify(b.system||{},null,2))}</pre>`;
}
function fillSettings(){const c=state.bootstrap?.webConfig||{};els.forgeBaseUrl.value=c.forgeBaseUrl||'http://127.0.0.1:7860';els.defaultSteps.value=c.steps??28;els.defaultCfg.value=c.cfg??5.5;els.defaultHiresScale.value=c.hiresScale??1.5;els.defaultDenoise.value=c.denoise??0.32;els.autoOpenWeb.checked=c.autoOpen!==false;els.minimizeDesktop.checked=c.minimizeDesktop!==false;els.imageSteps.value=c.steps??28;els.imageCfg.value=c.cfg??5.5;els.imageHiresScale.value=c.hiresScale??1.5;els.imageDenoise.value=c.denoise??0.32;els.imageHires.checked=c.hiresFix!==false;}

async function refreshBootstrap(){
  const b=await api('/api/bootstrap');state.bootstrap=b;state.chats=b.snapshot?.chats||[];state.memories=b.snapshot?.memories||[];if(!state.currentChatId)state.currentChatId=state.chats[0]?.id||null;setDot(els.backendDot,'online');els.backendText.textContent='Nexa backend online';applyForgeSnapshot(b.forge,b.webConfig);renderChats();renderCurrentChat();renderMemory();renderKnowledge();renderSystem();fillSettings();
}
async function refreshForge(){const f=await api('/api/forge/status');state.bootstrap.forge=f;applyForgeSnapshot(f,state.bootstrap.webConfig);renderSystem();return f;}

function bind(){
  $$('#mainNav button').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  els.newChatBtn.addEventListener('click',newChat);els.deleteChatBtn.addEventListener('click',()=>deleteCurrentChat().catch(e=>toast(e.message,'error')));els.sendBtn.addEventListener('click',send);els.stopChatBtn.addEventListener('click',stopActive);
  els.promptInput.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});
  els.fileInput.addEventListener('change',()=>{state.pendingFiles.push(...[...els.fileInput.files]);els.fileInput.value='';renderAttachments();});
  els.generateImageBtn.addEventListener('click',async()=>{try{await generateForge(forgeFormBody());}catch(e){toast(e.message||String(e),'error');}});
  els.interruptImageBtn.addEventListener('click',async()=>{await api('/api/forge/interrupt',{method:'POST',body:{}}).catch(()=>{});toast('Interrupción enviada a Forge.');});
  els.knowledgeSearchBtn.addEventListener('click',async()=>{const q=els.knowledgeQuery.value.trim();if(!q)return;try{const j=await api('/api/knowledge/search',{method:'POST',body:{query:q,options:{limit:12}}});const rows=Array.isArray(j.results)?j.results:(j.results?.results||[]);els.knowledgeResults.innerHTML=rows.length?rows.map(x=>`<div class="result-item"><strong>${escapeHtml(x.documentName||x.title||x.libraryName||'Resultado')}</strong><small>${escapeHtml(compact(x.text||x.content||JSON.stringify(x),480))}</small></div>`).join(''):'<div class="list-item"><small>Sin resultados.</small></div>';}catch(e){toast(e.message,'error');}});
  els.saveMemoryBtn.addEventListener('click',async()=>{const text=els.memoryText.value.trim();if(!text)return;const j=await api('/api/memory/save',{method:'POST',body:{text,enabled:true}});state.memories.unshift(j.memory);els.memoryText.value='';renderMemory();});
  els.refreshForgeBtn.addEventListener('click',()=>refreshForge().catch(e=>toast(e.message,'error')));
  $$('[data-engine-action]').forEach(b=>b.addEventListener('click',async()=>{const j=await api('/api/engine/action',{method:'POST',body:{action:b.dataset.engineAction}});state.bootstrap.engine=j.result;renderSystem();toast(`Ollama: ${b.dataset.engineAction}`);}));
  els.webSettingsForm.addEventListener('submit',async e=>{e.preventDefault();const body={forgeBaseUrl:els.forgeBaseUrl.value.trim(),steps:Number(els.defaultSteps.value),cfg:Number(els.defaultCfg.value),hiresScale:Number(els.defaultHiresScale.value),denoise:Number(els.defaultDenoise.value),hiresFix:true,autoOpen:els.autoOpenWeb.checked,minimizeDesktop:els.minimizeDesktop.checked,forgeModel:els.forgeModelSelect.value,forgeSampler:els.forgeSamplerSelect.value,forgeScheduler:els.forgeSchedulerSelect.value,forgeUpscaler:els.forgeUpscalerSelect.value,forgeHiresUpscaler:els.forgeHiresSelect.value};const j=await api('/api/web/settings',{method:'POST',body});state.bootstrap.webConfig=j.config;toast('Configuración web guardada.','success');await refreshForge().catch(()=>{});});
  els.testForgeBtn.addEventListener('click',async()=>{els.forgeTestResult.textContent='Probando…';try{await api('/api/web/settings',{method:'POST',body:{forgeBaseUrl:els.forgeBaseUrl.value.trim()}});const f=await refreshForge();els.forgeTestResult.textContent=f.ok?`Conectado · ${f.models?.length||0} modelo(s)`:(f.error||'Offline');}catch(e){els.forgeTestResult.textContent=e.message;}});
  window.addEventListener('beforeunload',()=>{if(state.activeRequestId)navigator.sendBeacon?.('/api/chat/stop',JSON.stringify({requestId:state.activeRequestId}));});
}

async function init(){cache();bind();await getSession();await refreshBootstrap();if(!state.currentChatId)newChat();}
init().catch(error=>{console.error(error);document.body.innerHTML=`<pre style="padding:24px;color:#ff9aa5">Nexa Web Control no pudo iniciar:\n${escapeHtml(error.stack||error.message||String(error))}</pre>`;});
