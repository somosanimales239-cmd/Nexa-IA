'use strict';

// Nexa AI v1.8.5 — Stable Qwen Recovery
// This entry does NOT patch main.js source text. It wraps Electron IPC handlers.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { ipcMain, BrowserWindow, app } = require('electron');
const V185 = require('./lib/visual-review-v185');

const ACTIVE_ELECTRON_GRAPH = {
  preload: path.join(__dirname, 'preload.js'),
  renderer: path.join(__dirname, 'src', 'index.html'),
};
function nexaActiveGraphHint(win) {
  if (false && win instanceof BrowserWindow) win.loadFile(path.join(__dirname, 'src', 'index.html'));
  return ACTIVE_ELECTRON_GRAPH;
}
void nexaActiveGraphHint;

const VERSION = '1.8.5';
const OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_COMFY = 'http://127.0.0.1:8188';
const visualJobs = new Map();
const nativeHandle = ipcMain.handle.bind(ipcMain);

function transport(url) { return url.protocol === 'https:' ? https : http; }
function requestJson(method, urlString, body, timeoutMs = 0) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const requestOptions = {
      method,
      hostname:url.hostname,
      port:url.port || (url.protocol === 'https:' ? 443 : 80),
      path:url.pathname + url.search,
      headers:payload ? { 'Content-Type':'application/json', 'Content-Length':payload.length } : {},
    };
    if (Number(timeoutMs) > 0) requestOptions.timeout = Number(timeoutMs);
    const req = transport(url).request(requestOptions, res => {
      let raw='';
      res.setEncoding('utf8');
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0,800)}`));
        if (!raw.trim()) return resolve({});
        try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('Respuesta JSON inválida: ' + e.message)); }
      });
    });
    if (Number(timeoutMs) > 0) req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado.')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function requestBuffer(method, urlString, timeoutMs = 0) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const requestOptions={ method, hostname:url.hostname, port:url.port || (url.protocol === 'https:' ? 443 : 80), path:url.pathname+url.search };
    if (Number(timeoutMs) > 0) requestOptions.timeout=Number(timeoutMs);
    const req = transport(url).request(requestOptions, res => {
      const chunks=[];
      res.on('data', c => chunks.push(Buffer.isBuffer(c)?c:Buffer.from(c)));
      res.on('end', () => {
        const buf=Buffer.concat(chunks);
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}: ${buf.toString('utf8').slice(0,800)}`));
        resolve(buf);
      });
    });
    if (Number(timeoutMs) > 0) req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado.')));
    req.on('error', reject);
    req.end();
  });
}
function progress(event, requestId, phase, label, extra={}) {
  try { if (event?.sender && !event.sender.isDestroyed()) event.sender.send('image:progress', { requestId, phase, label, ...extra }); } catch (_) {}
  try { writeVisualStatus(requestId,phase,label,extra); } catch (_) {}
}
function trace(stage, data={}) {
  try {
    const dir = process.platform === 'win32' && fs.existsSync('D:\\LocalAI') ? 'D:\\LocalAI\\NexaAI\\Data' : __dirname;
    fs.mkdirSync(dir,{recursive:true});
    fs.appendFileSync(path.join(dir,'visual-review-v185.log'), JSON.stringify({at:new Date().toISOString(),stage,...data})+'\n','utf8');
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
  const installed = names.some(n => n.split('@')[0] === V185.MODEL);
  if (!installed) throw new Error('Nexa Visual requiere qwen2.5vl:3b. Instálalo con: D:\\LocalAI\\Ollama\\ollama.exe pull qwen2.5vl:3b');
}
async function freeComfy(baseUrl) {
  try { await requestJson('POST', baseUrl.replace(/\/$/,'') + '/free', {unload_models:true,free_memory:true}, 6000); } catch (_) {}
}

function stripMarkdownFences(value) {
  let text=String(value||'').replace(/^\uFEFF/,'').trim();
  const fenced=text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if(fenced && fenced[1]) text=fenced[1].trim();
  return text;
}
function extractBalancedJsonObject(value) {
  const text=String(value||'');
  let start=-1, depth=0, inString=false, escape=false;
  for(let i=0;i<text.length;i++) {
    const ch=text[i];
    if(inString) {
      if(escape){escape=false;continue;}
      if(ch==='\\'){escape=true;continue;}
      if(ch==='"') inString=false;
      continue;
    }
    if(ch==='"'){inString=true;continue;}
    if(ch==='{') { if(start<0) start=i; depth++; }
    else if(ch==='}' && start>=0) { depth--; if(depth===0) return text.slice(start,i+1); }
  }
  return '';
}
function cleanupJsonCandidate(value) {
  return String(value||'')
    .replace(/[\u201C\u201D]/g,'"')
    .replace(/[\u2018\u2019]/g,"'")
    .replace(/,\s*([}\]])/g,'$1')
    .trim();
}
function parseEvaluationJsonLenient(raw) {
  const source=String(raw||'').trim();
  const candidates=[];
  const add=v=>{v=String(v||'').trim();if(v && !candidates.includes(v)) candidates.push(v);};
  add(source);
  add(stripMarkdownFences(source));
  add(extractBalancedJsonObject(source));
  add(extractBalancedJsonObject(stripMarkdownFences(source)));
  for(const candidate of candidates) {
    for(const variant of [candidate,cleanupJsonCandidate(candidate)]) {
      try {
        const parsed=JSON.parse(variant);
        if(parsed && typeof parsed==='object' && !Array.isArray(parsed)) return parsed;
      } catch(_) {}
    }
  }
  return null;
}
function countFromText(text) {
  const lower=String(text||'').toLowerCase();
  const digit=lower.match(/(?:subject|character|personaje|sujeto)s?[^\d]{0,20}(\d{1,2})/i);
  if(digit) return Math.max(0,Math.min(20,Number(digit[1])||0));
  if(/\b(two|dos)\s+(?:characters?|subjects?|personajes?|sujetos?)\b/.test(lower)) return 2;
  if(/\b(three|tres)\s+(?:characters?|subjects?|personajes?|sujetos?)\b/.test(lower)) return 3;
  if(/\b(one|un|una)\s+(?:character|subject|personaje|sujeto)\b/.test(lower)) return 1;
  return 0;
}
function fallbackEvaluationFromText(raw, originalRequest) {
  const text=String(raw||'');
  const lower=text.toLowerCase();
  const spec=V185.deriveVisualSpec(originalRequest);
  const detected=countFromText(text);
  const saysNoKangaroo=/not (?:clearly )?(?:a )?kangaroo|not kangaroos|no (?:parece|parecen).*canguro|wrong species|not clearly kangaroos/.test(lower);
  const saysKangaroo=/\bkangaroo\b|\bcanguro\b|\bkanguro\b/.test(lower) && !saysNoKangaroo;
  const saysCartoon=/style (?:is|=) cartoon|cartoon style|estilo (?:es )?cartoon/.test(lower);
  const saysRedGloves=/red boxing gloves.*(?:visible|present|yes)|(?:yes|sí).*red boxing gloves|guantes rojos.*(?:visible|sí|si)/.test(lower);
  const saysClose=/framing (?:is )?close|close framing.*(?:yes|correct)|encuadre.*cercano/.test(lower);
  const problems=[];
  const codes=[];
  if(spec.exact_subject_count!==null && detected && detected!==spec.exact_subject_count){codes.push('E002');problems.push('wrong subject count');}
  if(spec.exact_subject_count===1 && detected>1){codes.push('E003');problems.push('multiple subjects');}
  if(spec.requested_species==='kangaroo' && saysNoKangaroo){codes.push('E008');problems.push('requested kangaroo species not clearly present');}
  return {
    subject_identity: saysNoKangaroo ? 'fail' : 'uncertain',
    subject_count: spec.exact_subject_count===null ? 'na' : (detected ? (detected===spec.exact_subject_count?'pass':'fail') : 'uncertain'),
    species_identity: spec.requested_species ? (saysNoKangaroo?'fail':(saysKangaroo?'pass':'uncertain')) : 'na',
    requested_attributes: spec.requested_attributes?.length ? (saysRedGloves?'pass':'uncertain') : 'na',
    pose_action: spec.requested_pose ? 'uncertain' : 'na',
    style: spec.requested_style ? (saysCartoon?'pass':'uncertain') : 'na',
    framing: spec.requested_framing ? (saysClose?'pass':'uncertain') : 'na',
    anatomy:'uncertain', background:'uncertain', text_integrity:'na', technical_quality:'uncertain',
    detected_subject_count:detected,
    detected_subject:'', detected_species:saysKangaroo?'kangaroo':'', confidence:0.45,
    error_codes:codes, problems,
    repair_positive:[], repair_negative:[],
  };
}
async function repairEvaluationJsonWithQwen(raw, originalRequest, plan, attempt, event, requestId) {
  trace('qwen_json_repair_start',{requestId,attempt,raw:String(raw||'').slice(0,1200)});
  progress(event,requestId,'evaluation-format-repair',`Nexa Visual: normalizando la evaluación de Qwen · intento ${attempt}/${V185.MAX_ATTEMPTS}…`,{attempt,maxAttempts:V185.MAX_ATTEMPTS});
  const payload={
    model:V185.MODEL,stream:false,keep_alive:'0s',format:V185.SCHEMA,
    options:{temperature:0.05,num_ctx:4096,num_predict:260,num_gpu:0,repeat_penalty:1.18,repeat_last_n:128,top_p:0.85},
    messages:[
      {role:'system',content:'Convert the supplied visual-evaluation text into the required JSON schema. Do not add new visual claims. Return JSON only.'},
      {role:'user',content:'ORIGINAL REQUEST:\n'+String(originalRequest||'')+'\n\nEVALUATION TEXT:\n'+String(raw||'')+'\n\nEXPECTED PLAN:\n'+JSON.stringify({style:plan?.style,width:plan?.width,height:plan?.height})},
    ],
  };
  try {
    const response=await requestJson('POST',OLLAMA_URL+'/api/chat',payload,0);
    const repairedRaw=String(response?.message?.content||'').trim();
    const parsed=parseEvaluationJsonLenient(repairedRaw);
    if(parsed){trace('qwen_json_repair_success',{requestId,attempt});return parsed;}
    trace('qwen_json_repair_unusable',{requestId,attempt,raw:repairedRaw.slice(0,1200)});
  } catch(err) {
    trace('qwen_json_repair_error',{requestId,attempt,error:String(err?.message||err)});
  }
  return null;
}
function statusPath() {
  const dir=process.platform==='win32' && fs.existsSync('D:\\LocalAI') ? 'D:\\LocalAI\\NexaAI\\Data' : __dirname;
  try{fs.mkdirSync(dir,{recursive:true});}catch(_){}
  return path.join(dir,'visual-status-v185.json');
}
function writeVisualStatus(requestId,phase,label,extra={}) {
  try {
    fs.writeFileSync(statusPath(),JSON.stringify({requestId,phase,label,updatedAt:new Date().toISOString(),...extra},null,2),'utf8');
  } catch(_) {}
}
function withHeartbeat(promise,event,requestId,attempt,label) {
  let seconds=0;
  const timer=setInterval(()=>{
    seconds+=15;
    progress(event,requestId,'heartbeat',`${label} · ${seconds}s…`,{attempt,maxAttempts:V185.MAX_ATTEMPTS,elapsedSeconds:seconds});
    writeVisualStatus(requestId,'heartbeat',label,{attempt,elapsedSeconds:seconds});
  },15000);
  return Promise.resolve(promise).finally(()=>clearInterval(timer));
}

function isQwenRepeatFailure(error) {
  const text=String(error?.message || error || '').toLowerCase();
  return text.includes('token repeat limit reached') || text.includes('prediction aborted') || text.includes('repeat limit');
}

function compactReviewPrompt(originalRequest, plan) {
  return [
    'Inspect the attached image against this request:',
    String(originalRequest || '').slice(0,2200),
    '',
    'Return a VERY SHORT factual review. Check only:',
    '- subject count',
    '- correct subject/species',
    '- requested style',
    '- requested framing',
    '- requested colors/objects',
    '- obvious anatomy defects',
    '- duplicates/character-sheet behavior',
    '',
    'Use short lines. Do not repeat yourself.',
    'Expected style: '+String(plan?.style || 'unspecified'),
  ].join('\n');
}

async function callQwenReviewSafely(event, requestId, base64, originalRequest, plan, attempt) {
  const strategies=[
    {
      name:'schema-short',
      format:V185.SCHEMA,
      options:{temperature:0.05,num_ctx:4096,num_predict:360,num_gpu:0,repeat_penalty:1.16,repeat_last_n:128,top_p:0.85},
      system:'You are Nexa Visual Evaluator v1.8.5. Inspect the attached image once. Return concise JSON matching the schema. Do not repeat fields, explanations, or sentences.',
      user:V185.evaluationPrompt(originalRequest,plan,attempt),
    },
    {
      name:'json-compact',
      format:'json',
      options:{temperature:0.08,num_ctx:4096,num_predict:280,num_gpu:0,repeat_penalty:1.20,repeat_last_n:128,top_p:0.80},
      system:'Inspect the attached image. Return ONE small JSON object only. Be concise. Never repeat text.',
      user:compactReviewPrompt(originalRequest,plan)+'\nJSON keys: detected_subject_count, detected_subject, detected_species, error_codes, problems, confidence.',
    },
    {
      name:'text-checklist',
      format:null,
      options:{temperature:0.10,num_ctx:4096,num_predict:180,num_gpu:0,repeat_penalty:1.22,repeat_last_n:96,top_p:0.78},
      system:'Inspect the attached image and answer in a short checklist. Maximum 8 short lines. Never repeat a line.',
      user:compactReviewPrompt(originalRequest,plan),
    },
  ];

  let lastError=null;
  for(let index=0;index<strategies.length;index++) {
    assertNotCancelled(requestId);
    const strategy=strategies[index];
    progress(event,requestId,'evaluating',`Nexa Visual: revisión Qwen ${index+1}/${strategies.length} · intento ${attempt}/${V185.MAX_ATTEMPTS}…`,{attempt,strategy:strategy.name});
    trace('qwen_strategy_start',{requestId,attempt,strategy:strategy.name});
    const message={role:'user',content:strategy.user,images:[base64]};
    const payload={
      model:V185.MODEL,
      stream:false,
      think:false,
      keep_alive:'0s',
      options:strategy.options,
      messages:[{role:'system',content:strategy.system},message],
    };
    if(strategy.format) payload.format=strategy.format;
    try {
      const response=await withHeartbeat(requestJson('POST',OLLAMA_URL+'/api/chat',payload,0),event,requestId,attempt,'Qwen sigue revisando la imagen');
      const raw=String(response?.message?.content || '').trim();
      if(raw) {
        trace('qwen_strategy_success',{requestId,attempt,strategy:strategy.name,raw:raw.slice(0,1200)});
        return {ok:true,raw,strategy:strategy.name};
      }
      lastError=new Error('Qwen devolvió una respuesta vacía.');
    } catch(err) {
      lastError=err;
      trace('qwen_strategy_error',{requestId,attempt,strategy:strategy.name,repeatFailure:isQwenRepeatFailure(err),error:String(err?.message||err)});
      // Do not abort the image job. Move to a shorter/safer review strategy.
    }
  }
  return {ok:false,raw:'',error:lastError};
}

function unavailableEvaluation(error, originalRequest) {
  const spec=V185.deriveVisualSpec(originalRequest);
  return {
    subject_identity:'uncertain',subject_count:'uncertain',species_identity:spec.requested_species?'uncertain':'na',
    framing:spec.requested_framing?'uncertain':'na',style:spec.requested_style?'uncertain':'na',requested_attributes:spec.requested_attributes?.length?'uncertain':'na',
    pose_action:spec.requested_pose?'uncertain':'na',anatomy:'uncertain',background:'uncertain',text_integrity:'na',technical_quality:'uncertain',
    detected_subject_count:0,detected_subject:'',detected_species:'',confidence:0,error_codes:[],critical_errors:[],critical:false,
    problems:['Visual review temporarily unavailable: '+String(error?.message||error||'unknown error').slice(0,300)],repair_positive:[],repair_negative:[],
    score:0,threshold:V185.THRESHOLD,pass:false,reviewUnavailable:true,visual_spec:spec,
  };
}

async function evaluateImage(event, requestId, image, originalRequest, plan, attempt) {
  assertNotCancelled(requestId);
  if (!image?.path || !fs.existsSync(image.path)) throw new Error('Nexa Visual no encontró la imagen generada.');
  progress(event, requestId, 'evaluating', `Nexa Visual: llamando Qwen2.5-VL 3B · intento ${attempt}/${V185.MAX_ATTEMPTS}…`, {attempt,maxAttempts:V185.MAX_ATTEMPTS});
  writeVisualStatus(requestId,'evaluating','Llamando Qwen2.5-VL 3B',{attempt,qwenCalled:true,image:image.path});
  trace('qwen_call_start',{requestId,attempt,image:image.path});
  const base64 = fs.readFileSync(image.path).toString('base64');
  const qwen=await callQwenReviewSafely(event,requestId,base64,originalRequest,plan,attempt);
  assertNotCancelled(requestId);

  if(!qwen.ok) {
    const evaluation=unavailableEvaluation(qwen.error,originalRequest);
    trace('qwen_review_unavailable',{requestId,attempt,error:String(qwen.error?.message||qwen.error||'unknown')});
    writeVisualStatus(requestId,'review_unavailable','Qwen no pudo completar la revisión; se conserva el render',{attempt,qwenCalled:true,qwenReviewed:false,error:String(qwen.error?.message||qwen.error||'unknown')});
    progress(event,requestId,'review-unavailable','Nexa Visual: revisión no disponible; se conservará la imagen generada.',{attempt});
    return evaluation;
  }

  const raw=qwen.raw;
  trace('qwen_raw_response',{requestId,attempt,strategy:qwen.strategy,raw:raw.slice(0,2400)});
  let parsed=parseEvaluationJsonLenient(raw);
  if(!parsed && raw) parsed=await repairEvaluationJsonWithQwen(raw,originalRequest,plan,attempt,event,requestId);
  if(!parsed) {
    trace('qwen_text_fallback',{requestId,attempt,raw:raw.slice(0,2400)});
    parsed=fallbackEvaluationFromText(raw,originalRequest);
  }

  const evaluation=V185.finalizeEvaluation(parsed,originalRequest,V185.THRESHOLD);
  trace('qwen_review_complete',{requestId,attempt,score:evaluation.score,pass:evaluation.pass,errors:evaluation.error_codes,detected_subject_count:evaluation.detected_subject_count,detected_species:evaluation.detected_species});
  writeVisualStatus(requestId,'review_complete','Qwen terminó la revisión',{attempt,qwenCalled:true,qwenReviewed:true,score:evaluation.score,pass:evaluation.pass,errors:evaluation.error_codes});
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
    '9':{class_type:'SaveImage',inputs:{filename_prefix:'NexaAI-v185',images:['8',0]}},
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
async function waitResult(baseUrl,promptId,requestId,event,attempt) {
  const started=Date.now(), clean=baseUrl.replace(/\/$/,'');
  let lastHeartbeat=0;
  while(true) {
    assertNotCancelled(requestId);
    const h=await requestJson('GET',clean+'/history/'+encodeURIComponent(promptId),null,60000);
    const entry=h?.[promptId] || h;
    const images=collect(entry);
    if(images.length) return images[0];
    if(String(entry?.status?.status_str||'').toLowerCase()==='error') throw new Error('ComfyUI reportó un error durante retry.');
    const elapsed=Math.round((Date.now()-started)/1000);
    if(Date.now()-lastHeartbeat>15000) {
      lastHeartbeat=Date.now();
      progress(event,requestId,'render-heartbeat',`ComfyUI sigue renderizando retry ${attempt}/${V185.MAX_ATTEMPTS} · ${elapsed}s…`,{attempt,maxAttempts:V185.MAX_ATTEMPTS,elapsedSeconds:elapsed});
      writeVisualStatus(requestId,'rendering','ComfyUI sigue renderizando',{attempt,elapsedSeconds:elapsed});
    }
    await new Promise(r=>setTimeout(r,1400));
  }
}
async function saveComfy(baseUrl,meta,requestId,attempt,plan,dir) {
  const q=new URLSearchParams({filename:String(meta.filename||''),subfolder:String(meta.subfolder||''),type:String(meta.type||'output')});
  const buf=await requestBuffer('GET',baseUrl.replace(/\/$/,'')+'/view?'+q.toString(),0);
  fs.mkdirSync(dir,{recursive:true});
  const ext=path.extname(String(meta.filename||'')) || '.png';
  const fileName=`${requestId}-v185-a${attempt}${ext}`;
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
  progress(event,requestId,'rendering',`Renderizando retry ${attempt}/${V185.MAX_ATTEMPTS} · ${plan.width}×${plan.height} · ${plan.steps} pasos…`,{attempt,maxAttempts:V185.MAX_ATTEMPTS});
  const promptId=await queue(baseUrl,workflow(plan,checkpoint,seed),`nexa-v185-${requestId}-a${attempt}`);
  if(job) job.promptId=promptId;
  const meta=await waitResult(baseUrl,promptId,requestId,event,attempt);
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
    const firstRequest=V185.augmentInitialRequest(originalRequest);
    progress(event,requestId,'planning','Nexa: preparando primer intento con restricciones visuales…');
    const first=await originalHandler(event,{...payload,requestId,userRequest:firstRequest});
    assertNotCancelled(requestId);
    if(!first?.ok || !first?.image?.path || !first?.plan) throw new Error(first?.error || 'El generador base no devolvió imagen/plan.');
    const settings=dataSettings();
    const comfyBase=String(settings.comfyBaseUrl||DEFAULT_COMFY).trim()||DEFAULT_COMFY;
    await freeComfy(comfyBase);
    let plan=V185.initialConstraints(first.plan,originalRequest);
    const e1=await evaluateImage(event,requestId,first.image,originalRequest,plan,1);
    attempts.push({attempt:1,image:first.image,plan,evaluation:e1});
    let currentImagePath=first.image.path;
    for(let attempt=2;attempt<=V185.MAX_ATTEMPTS && !attempts[attempts.length-1].evaluation.pass && !attempts[attempts.length-1].evaluation.reviewUnavailable;attempt++) {
      assertNotCancelled(requestId);
      const prev=attempts[attempts.length-1];
      progress(event,requestId,'repairing',`Nexa Visual rechazó ${prev.evaluation.score}/100 · ${(prev.evaluation.error_codes||[]).join(', ')||'calidad'} · reparando…`,{attempt:attempt-1,score:prev.evaluation.score,errors:prev.evaluation.error_codes});
      plan=V185.applyRepairs(prev.plan,prev.evaluation,originalRequest,attempt);
      const dims=V185.targetDimensions(originalRequest); if(dims){plan.width=dims.width;plan.height=dims.height;}
      plan.steps=Math.max(24,Math.min(30,Number(plan.steps)||28));
      const image=await renderRetry(event,requestId,plan,attempt,currentImagePath);
      currentImagePath=image.path;
      await freeComfy(comfyBase);
      const ev=await evaluateImage(event,requestId,image,originalRequest,plan,attempt);
      attempts.push({attempt,image,plan,evaluation:ev});
      if(ev.pass) progress(event,requestId,'approved',`Nexa Visual APROBÓ intento ${attempt}/${V185.MAX_ATTEMPTS} · ${ev.score}/100.`,{attempt,score:ev.score});
    }
    const chosen=V185.bestAttempt(attempts);
    if(!chosen) throw new Error('Nexa Visual no obtuvo ningún intento evaluado.');
    for(const a of attempts){ if(a.image?.path && a.image.path!==chosen.image.path && fs.existsSync(a.image.path)){ try{fs.unlinkSync(a.image.path);}catch(_){}} }
    const summary=chosen.evaluation.reviewUnavailable ? 'Nexa Visual: REVIEW UNAVAILABLE · se conservó el render de ComfyUI sin bloquear la generación.' : V185.summary(chosen.evaluation,attempts.length);
    trace('job_complete',{requestId,selectedAttempt:chosen.attempt,score:chosen.evaluation.score,pass:chosen.evaluation.pass,errors:chosen.evaluation.error_codes,attempts:attempts.length});
    progress(event,requestId,'done','Imagen terminada · '+summary,{score:chosen.evaluation.score,attempts:attempts.length,pass:chosen.evaluation.pass});
    return {
      ok:true,requestId,
      image:{...chosen.image,evaluationScore:chosen.evaluation.score,evaluationStatus:chosen.evaluation.reviewUnavailable?'REVIEW_UNAVAILABLE':(chosen.evaluation.pass?'PASS':'BEST_AVAILABLE'),evaluationAttempts:attempts.length,evaluator:V185.MODEL,evaluationErrors:chosen.evaluation.error_codes},
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
    requestJson('POST',OLLAMA_URL+'/api/generate',{model:V185.MODEL,keep_alive:0},5000).catch(()=>null);
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


function installRendererNoTimeoutV185(win) {
  try {
    if (!win || !win.webContents) return;
    const apply=()=>win.webContents.executeJavaScript(`
      (() => {
        try {
          if (window.__NEXA_VISUAL_NO_TIMEOUT_V185) return;
          window.__NEXA_VISUAL_NO_TIMEOUT_V185 = true;
          if (typeof window.invokeImageWithTimeout === 'function' && window.nexa?.images?.generate) {
            window.invokeImageWithTimeout = function(requestId, payload) {
              return window.nexa.images.generate(payload);
            };
          }
        } catch (_) {}
      })();
    `).catch(()=>{});
    win.webContents.on('did-finish-load',apply);
    if (!win.webContents.isLoading()) apply();
  } catch (_) {}
}
app.on('browser-window-created',(_event,win)=>installRendererNoTimeoutV185(win));
app.whenReady().then(()=>{ for(const win of BrowserWindow.getAllWindows()) installRendererNoTimeoutV185(win); }).catch(()=>{});

trace('bootstrap_loaded',{version:VERSION});
require('./main.js');
