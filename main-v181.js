'use strict';

// Nexa AI v1.8.1 — Visual Review Bridge
// This entry does NOT patch main.js source text. It wraps Electron IPC handlers.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { ipcMain, BrowserWindow } = require('electron');
const V181 = require('./lib/visual-review-v181');

const ACTIVE_ELECTRON_GRAPH = {
  preload: path.join(__dirname, 'preload.js'),
  renderer: path.join(__dirname, 'src', 'index.html'),
};
function nexaActiveGraphHint(win) {
  if (false && win instanceof BrowserWindow) win.loadFile(path.join(__dirname, 'src', 'index.html'));
  return ACTIVE_ELECTRON_GRAPH;
}
void nexaActiveGraphHint;

const VERSION = '1.8.1';
const OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_COMFY = 'http://127.0.0.1:8188';
const visualJobs = new Map();
const nativeHandle = ipcMain.handle.bind(ipcMain);

function transport(url) { return url.protocol === 'https:' ? https : http; }
function requestJson(method, urlString, body, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = transport(url).request({
      method,
      hostname:url.hostname,
      port:url.port || (url.protocol === 'https:' ? 443 : 80),
      path:url.pathname + url.search,
      timeout:timeoutMs,
      headers:payload ? { 'Content-Type':'application/json', 'Content-Length':payload.length } : {},
    }, res => {
      let raw='';
      res.setEncoding('utf8');
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0,800)}`));
        if (!raw.trim()) return resolve({});
        try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('Respuesta JSON inválida: ' + e.message)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado.')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function requestBuffer(method, urlString, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const req = transport(url).request({ method, hostname:url.hostname, port:url.port || (url.protocol === 'https:' ? 443 : 80), path:url.pathname+url.search, timeout:timeoutMs }, res => {
      const chunks=[];
      res.on('data', c => chunks.push(Buffer.isBuffer(c)?c:Buffer.from(c)));
      res.on('end', () => {
        const buf=Buffer.concat(chunks);
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}: ${buf.toString('utf8').slice(0,800)}`));
        resolve(buf);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado.')));
    req.on('error', reject);
    req.end();
  });
}
function progress(event, requestId, phase, label, extra={}) {
  try { if (event?.sender && !event.sender.isDestroyed()) event.sender.send('image:progress', { requestId, phase, label, ...extra }); } catch (_) {}
}
function trace(stage, data={}) {
  try {
    const dir = process.platform === 'win32' && fs.existsSync('D:\\LocalAI') ? 'D:\\LocalAI\\NexaAI\\Data' : __dirname;
    fs.mkdirSync(dir,{recursive:true});
    fs.appendFileSync(path.join(dir,'visual-review-v181.log'), JSON.stringify({at:new Date().toISOString(),stage,...data})+'\n','utf8');
  } catch (_) {}
}
function dataSettings() {
  const candidates=[];
  if (process.platform === 'win32') candidates.push('D:\\LocalAI\\NexaAI\\Data\\nexa-data.json');
  for (const file of candidates) {
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file,'utf8')).settings || {}; } catch (_) {}
  }
  return {};
}
function assertNotCancelled(requestId) {
  if (visualJobs.get(requestId)?.cancelled) throw new Error('Generación detenida por el usuario.');
}
async function ensureQwen() {
  const tags = await requestJson('GET', OLLAMA_URL + '/api/tags', null, 6000);
  const names = Array.isArray(tags.models) ? tags.models.map(x => String(x.name || x.model || '')) : [];
  const installed = names.some(n => n.split('@')[0] === V181.MODEL);
  if (!installed) throw new Error('Nexa Visual requiere qwen2.5vl:3b. Instálalo con: D:\\LocalAI\\Ollama\\ollama.exe pull qwen2.5vl:3b');
}
async function freeComfy(baseUrl) {
  try { await requestJson('POST', baseUrl.replace(/\/$/,'') + '/free', {unload_models:true,free_memory:true}, 6000); } catch (_) {}
}
async function evaluateImage(event, requestId, image, originalRequest, plan, attempt) {
  assertNotCancelled(requestId);
  if (!image?.path || !fs.existsSync(image.path)) throw new Error('Nexa Visual no encontró la imagen generada.');
  progress(event, requestId, 'evaluating', `Nexa Visual: llamando Qwen2.5-VL 3B · intento ${attempt}/${V181.MAX_ATTEMPTS}…`, {attempt,maxAttempts:V181.MAX_ATTEMPTS});
  trace('qwen_call_start',{requestId,attempt,image:image.path});
  const base64 = fs.readFileSync(image.path).toString('base64');
  const messages=[
    {role:'system',content:'You are Nexa Visual Evaluator v1.8.1. Inspect the attached image. Return only the requested structured JSON. Never claim you cannot see an attached image.'},
    {role:'user',content:V181.evaluationPrompt(originalRequest,plan,attempt),images:[base64]},
  ];
  const payload={model:V181.MODEL,stream:false,keep_alive:'0s',format:V181.SCHEMA,options:{temperature:0,num_ctx:4096,num_predict:750,num_gpu:0},messages};
  let response;
  try { response=await requestJson('POST', OLLAMA_URL + '/api/chat', payload, 180000); }
  catch (err) {
    trace('qwen_schema_retry',{requestId,attempt,error:String(err.message||err)});
    payload.format='json';
    response=await requestJson('POST', OLLAMA_URL + '/api/chat', payload, 180000);
  }
  assertNotCancelled(requestId);
  const raw=String(response?.message?.content || '').trim();
  if (!raw) throw new Error('Qwen2.5-VL respondió sin evaluación visual.');
  const start=raw.indexOf('{'), end=raw.lastIndexOf('}');
  if (start<0 || end<=start) throw new Error('Qwen2.5-VL no devolvió JSON utilizable.');
  let parsed;
  try { parsed=JSON.parse(raw.slice(start,end+1)); } catch(e) { throw new Error('Qwen2.5-VL devolvió JSON inválido: '+e.message); }
  const evaluation=V181.finalizeEvaluation(parsed,originalRequest,V181.THRESHOLD);
  trace('qwen_review_complete',{requestId,attempt,score:evaluation.score,pass:evaluation.pass,errors:evaluation.error_codes,detected_subject_count:evaluation.detected_subject_count,detected_species:evaluation.detected_species});
  return evaluation;
}
async function getCheckpoint(baseUrl) {
  const settings=dataSettings();
  if (settings.comfyCheckpoint) return String(settings.comfyCheckpoint);
  const clean=baseUrl.replace(/\/$/,'');
  const info=await requestJson('GET',clean+'/object_info/CheckpointLoaderSimple',null,10000);
  const choices=info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || info?.input?.required?.ckpt_name?.[0] || [];
  if (!Array.isArray(choices) || !choices.length) throw new Error('No se pudo detectar el checkpoint de ComfyUI para el retry.');
  return String(choices[0]);
}
function workflow(plan,checkpoint,seed) {
  return {
    '3':{class_type:'CheckpointLoaderSimple',inputs:{ckpt_name:checkpoint}},
    '4':{class_type:'CLIPTextEncode',inputs:{text:plan.positive_prompt,clip:['3',1]}},
    '5':{class_type:'CLIPTextEncode',inputs:{text:plan.negative_prompt,clip:['3',1]}},
    '6':{class_type:'EmptyLatentImage',inputs:{width:plan.width,height:plan.height,batch_size:1}},
    '7':{class_type:'KSampler',inputs:{seed,steps:plan.steps,cfg:plan.cfg,sampler_name:plan.sampler_name||'euler',scheduler:plan.scheduler||'normal',denoise:1,model:['3',0],positive:['4',0],negative:['5',0],latent_image:['6',0]}},
    '8':{class_type:'VAEDecode',inputs:{samples:['7',0],vae:['3',2]}},
    '9':{class_type:'SaveImage',inputs:{filename_prefix:'NexaAI-v181',images:['8',0]}},
  };
}
async function queue(baseUrl,wf,clientId) {
  const r=await requestJson('POST',baseUrl.replace(/\/$/,'')+'/prompt',{prompt:wf,client_id:clientId},15000);
  if(!r.prompt_id) throw new Error('ComfyUI no devolvió prompt_id para retry.');
  return r.prompt_id;
}
function collect(entry) {
  const out=[];
  for(const node of Object.values(entry?.outputs||{})) if(Array.isArray(node?.images)) out.push(...node.images);
  return out;
}
async function waitResult(baseUrl,promptId,requestId,timeoutMs=300000) {
  const start=Date.now(), clean=baseUrl.replace(/\/$/,'');
  while(Date.now()-start<timeoutMs) {
    assertNotCancelled(requestId);
    const h=await requestJson('GET',clean+'/history/'+encodeURIComponent(promptId),null,20000);
    const entry=h?.[promptId] || h;
    const images=collect(entry);
    if(images.length) return images[0];
    if(String(entry?.status?.status_str||'').toLowerCase()==='error') throw new Error('ComfyUI reportó un error durante retry.');
    await new Promise(r=>setTimeout(r,1400));
  }
  throw new Error('ComfyUI tardó demasiado durante retry.');
}
async function saveComfy(baseUrl,meta,requestId,attempt,plan,dir) {
  const q=new URLSearchParams({filename:String(meta.filename||''),subfolder:String(meta.subfolder||''),type:String(meta.type||'output')});
  const buf=await requestBuffer('GET',baseUrl.replace(/\/$/,'')+'/view?'+q.toString(),120000);
  fs.mkdirSync(dir,{recursive:true});
  const ext=path.extname(String(meta.filename||'')) || '.png';
  const fileName=`${requestId}-v181-a${attempt}${ext}`;
  const full=path.join(dir,fileName);
  fs.writeFileSync(full,buf);
  return {path:full,fileName,width:plan.width,height:plan.height,style:plan.style,positivePrompt:plan.positive_prompt,negativePrompt:plan.negative_prompt};
}
async function renderRetry(event,requestId,plan,attempt,firstImagePath) {
  const settings=dataSettings();
  const baseUrl=String(settings.comfyBaseUrl||DEFAULT_COMFY).trim() || DEFAULT_COMFY;
  const checkpoint=await getCheckpoint(baseUrl);
  const job=visualJobs.get(requestId); if(job) job.comfyBaseUrl=baseUrl;
  const seed=Math.floor(Math.random()*9007199254740991);
  progress(event,requestId,'rendering',`Renderizando retry ${attempt}/${V181.MAX_ATTEMPTS} · ${plan.width}×${plan.height} · ${plan.steps} pasos…`,{attempt,maxAttempts:V181.MAX_ATTEMPTS});
  const promptId=await queue(baseUrl,workflow(plan,checkpoint,seed),`nexa-v181-${requestId}-a${attempt}`);
  if(job) job.promptId=promptId;
  const meta=await waitResult(baseUrl,promptId,requestId);
  const dir=path.dirname(firstImagePath);
  return saveComfy(baseUrl,meta,requestId,attempt,plan,dir);
}
async function stopRetry(requestId) {
  const job=visualJobs.get(String(requestId));
  if(!job) return false;
  job.cancelled=true;
  if(job.comfyBaseUrl && job.promptId) {
    const clean=job.comfyBaseUrl.replace(/\/$/,'');
    await requestJson('POST',clean+'/queue',{delete:[job.promptId]},3500).catch(()=>null);
    await requestJson('POST',clean+'/interrupt',{prompt_id:job.promptId},3500).catch(()=>null);
  }
  return true;
}
async function visualGenerate(originalHandler,event,payload={}) {
  const requestId=String(payload.requestId||('img_'+Date.now()));
  const originalRequest=String(payload.userRequest||'').trim();
  if(!originalRequest) return originalHandler(event,payload);
  visualJobs.set(requestId,{cancelled:false,promptId:null,comfyBaseUrl:''});
  const attempts=[];
  try {
    progress(event,requestId,'visual-ready','Nexa Visual: comprobando qwen2.5vl:3b…');
    await ensureQwen();
    assertNotCancelled(requestId);
    const firstRequest=V181.augmentInitialRequest(originalRequest);
    progress(event,requestId,'planning','Nexa: preparando primer intento con restricciones visuales…');
    const first=await originalHandler(event,{...payload,requestId,userRequest:firstRequest});
    assertNotCancelled(requestId);
    if(!first?.ok || !first?.image?.path || !first?.plan) throw new Error(first?.error || 'El generador base no devolvió imagen/plan.');
    const settings=dataSettings();
    const comfyBase=String(settings.comfyBaseUrl||DEFAULT_COMFY).trim()||DEFAULT_COMFY;
    await freeComfy(comfyBase);
    let plan=V181.initialConstraints(first.plan,originalRequest);
    const e1=await evaluateImage(event,requestId,first.image,originalRequest,plan,1);
    attempts.push({attempt:1,image:first.image,plan,evaluation:e1});
    let currentImagePath=first.image.path;
    for(let attempt=2;attempt<=V181.MAX_ATTEMPTS && !attempts[attempts.length-1].evaluation.pass;attempt++) {
      assertNotCancelled(requestId);
      const prev=attempts[attempts.length-1];
      progress(event,requestId,'repairing',`Nexa Visual rechazó ${prev.evaluation.score}/100 · ${(prev.evaluation.error_codes||[]).join(', ')||'calidad'} · reparando…`,{attempt:attempt-1,score:prev.evaluation.score,errors:prev.evaluation.error_codes});
      plan=V181.applyRepairs(prev.plan,prev.evaluation,originalRequest,attempt);
      const dims=V181.targetDimensions(originalRequest); if(dims){plan.width=dims.width;plan.height=dims.height;}
      plan.steps=Math.max(24,Math.min(30,Number(plan.steps)||28));
      const image=await renderRetry(event,requestId,plan,attempt,currentImagePath);
      currentImagePath=image.path;
      await freeComfy(comfyBase);
      const ev=await evaluateImage(event,requestId,image,originalRequest,plan,attempt);
      attempts.push({attempt,image,plan,evaluation:ev});
      if(ev.pass) progress(event,requestId,'approved',`Nexa Visual APROBÓ intento ${attempt}/${V181.MAX_ATTEMPTS} · ${ev.score}/100.`,{attempt,score:ev.score});
    }
    const chosen=V181.bestAttempt(attempts);
    if(!chosen) throw new Error('Nexa Visual no obtuvo ningún intento evaluado.');
    for(const a of attempts){ if(a.image?.path && a.image.path!==chosen.image.path && fs.existsSync(a.image.path)){ try{fs.unlinkSync(a.image.path);}catch(_){}} }
    const summary=V181.summary(chosen.evaluation,attempts.length);
    trace('job_complete',{requestId,selectedAttempt:chosen.attempt,score:chosen.evaluation.score,pass:chosen.evaluation.pass,errors:chosen.evaluation.error_codes,attempts:attempts.length});
    progress(event,requestId,'done','Imagen terminada · '+summary,{score:chosen.evaluation.score,attempts:attempts.length,pass:chosen.evaluation.pass});
    return {
      ok:true,requestId,
      image:{...chosen.image,evaluationScore:chosen.evaluation.score,evaluationStatus:chosen.evaluation.pass?'PASS':'BEST_AVAILABLE',evaluationAttempts:attempts.length,evaluator:V181.MODEL,evaluationErrors:chosen.evaluation.error_codes},
      plan:chosen.plan,evaluation:chosen.evaluation,
      attempts:attempts.map(a=>({attempt:a.attempt,score:a.evaluation.score,pass:a.evaluation.pass,errors:a.evaluation.error_codes})),
      summary:`Imagen generada (${chosen.image.width}×${chosen.image.height}, estilo ${chosen.image.style}). ${summary}`,
    };
  } catch(err) {
    trace('job_error',{requestId,error:String(err?.stack||err)});
    progress(event,requestId,'visual-error','Nexa Visual ERROR: '+String(err?.message||err));
    throw err;
  } finally {
    visualJobs.delete(requestId);
    requestJson('POST',OLLAMA_URL+'/api/generate',{model:V181.MODEL,keep_alive:0},5000).catch(()=>null);
  }
}

ipcMain.handle = function(channel, listener) {
  if(channel === 'image:generate') {
    return nativeHandle(channel,(event,payload)=>visualGenerate(listener,event,payload||{}));
  }
  if(channel === 'image:stop') {
    return nativeHandle(channel,async(event,requestId)=>{
      await stopRetry(requestId).catch(()=>false);
      return listener(event,requestId);
    });
  }
  if(channel === 'store:get') {
    return nativeHandle(channel,async(...args)=>{
      const snapshot=await listener(...args);
      if(snapshot && typeof snapshot==='object') snapshot.appVersion=VERSION;
      return snapshot;
    });
  }
  return nativeHandle(channel,listener);
};

trace('bootstrap_loaded',{version:VERSION});
require('./main.js');
