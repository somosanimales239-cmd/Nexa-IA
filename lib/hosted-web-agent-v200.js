'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { app } = require('electron');

const VERSION = '2.0.0';

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function safeText(v,max=200000){return String(v??'').trim().slice(0,max);}
function transport(url){return url.protocol==='https:'?https:http;}
function requestBuffer(method,urlString,{headers={},body=null,timeoutMs=120000}={}){
  return new Promise((resolve,reject)=>{
    const url=new URL(urlString);const opts={method,hostname:url.hostname,port:url.port||(url.protocol==='https:'?443:80),path:url.pathname+url.search,headers:{...headers}};
    if(body && !Buffer.isBuffer(body)) body=Buffer.from(body);
    if(body) opts.headers['Content-Length']=body.length;
    const req=transport(url).request(opts,res=>{const chunks=[];res.on('data',c=>chunks.push(Buffer.from(c)));res.on('end',()=>{const buf=Buffer.concat(chunks);if(res.statusCode<200||res.statusCode>=300)return reject(new Error(`HTTP ${res.statusCode}: ${buf.toString('utf8').slice(0,800)}`));resolve({buffer:buf,headers:res.headers,statusCode:res.statusCode});});});
    req.setTimeout(timeoutMs,()=>req.destroy(new Error('Timeout')));req.on('error',reject);if(body)req.write(body);req.end();
  });
}
async function requestJson(method,url,body,headers={},timeoutMs=120000){
  const payload=body==null?null:Buffer.from(JSON.stringify(body));
  const r=await requestBuffer(method,url,{body:payload,timeoutMs,headers:{...headers,...(payload?{'Content-Type':'application/json'}:{})}});
  const text=r.buffer.toString('utf8');return text.trim()?JSON.parse(text):{};
}
function markerForToken(token){
  let bits='';for(const ch of String(token||'')){const code=ch.charCodeAt(0)&255;for(let i=7;i>=0;i--)bits+=(code&(1<<i))?'\u200C':'\u200B';}
  return '\u2063\u2063'+bits+'\u2064\u2064';
}
function configDir(){
  if(process.platform==='win32'){
    const preferred='D:\\LocalAI\\NexaAI\\HostedWeb';
    try{if(fs.existsSync('D:\\LocalAI')){fs.mkdirSync(preferred,{recursive:true});return preferred;}}catch(_){}
  }
  const dir=path.join(app.getPath('userData'),'HostedWeb');fs.mkdirSync(dir,{recursive:true});return dir;
}
function configPath(){return path.join(configDir(),'agent.json');}
function defaultConfig(){return {enabled:false,serverUrl:'https://YOUR-DOMAIN.com/nexa',agentToken:'',forgeBaseUrl:'http://127.0.0.1:7860',pollMs:1600};}
function loadConfig(){
  const file=configPath();
  if(!fs.existsSync(file)){fs.writeFileSync(file,JSON.stringify(defaultConfig(),null,2));return defaultConfig();}
  try{return {...defaultConfig(),...JSON.parse(fs.readFileSync(file,'utf8'))};}catch(_){return defaultConfig();}
}
function saveConfig(cfg){fs.mkdirSync(configDir(),{recursive:true});fs.writeFileSync(configPath(),JSON.stringify(cfg,null,2));}
function headersFor(cfg){return {'X-Nexa-Agent-Token':String(cfg.agentToken||''),'Authorization':`Bearer ${String(cfg.agentToken||'')}`};}
function apiUrl(cfg,rel){return String(cfg.serverUrl||'').replace(/\/$/,'')+'/'+String(rel).replace(/^\//,'');}
function forgeUrl(cfg,rel){return String(cfg.forgeBaseUrl||'http://127.0.0.1:7860').replace(/\/$/,'')+'/'+String(rel).replace(/^\//,'');}
function randomBoundary(){return '----NexaHosted'+crypto.randomBytes(12).toString('hex');}
async function uploadMultipart(url,headers,fileBuffer,fileName,mime='application/octet-stream'){
  const boundary=randomBoundary();const head=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${String(fileName).replace(/"/g,'')}"\r\nContent-Type: ${mime}\r\n\r\n`);const tail=Buffer.from(`\r\n--${boundary}--\r\n`);const body=Buffer.concat([head,fileBuffer,tail]);
  const r=await requestBuffer('POST',url,{headers:{...headers,'Content-Type':`multipart/form-data; boundary=${boundary}`},body,timeoutMs:300000});return JSON.parse(r.buffer.toString('utf8'));
}
function dataUrlToBuffer(value){const m=String(value||'').match(/^data:([^;]+);base64,(.+)$/s);if(!m)return null;return {mime:m[1],buffer:Buffer.from(m[2],'base64')};}
function guessExt(mime){if(/jpeg/.test(mime))return'jpg';if(/webp/.test(mime))return'webp';return'png';}

class HostedWebAgent{
  constructor({handlers,version=VERSION,config=null}={}){this.handlers=handlers||new Map();this.version=version;this.running=false;this.active=null;this.fixedConfig=config&&typeof config==='object'?{...defaultConfig(),...config}:null;this.cfg=this.fixedConfig||loadConfig();this.lastConfigMtime=0;}
  reloadConfig(){if(this.fixedConfig)return this.cfg;try{const stat=fs.statSync(configPath());if(stat.mtimeMs!==this.lastConfigMtime){this.lastConfigMtime=stat.mtimeMs;this.cfg=loadConfig();}}catch(_){}return this.cfg;}
  usable(){const c=this.reloadConfig();return c.enabled===true && /^https?:\/\//i.test(c.serverUrl||'') && String(c.agentToken||'').length>=20;}
  async start(){if(this.running)return;this.running=true;while(this.running){try{if(this.usable()){await this.heartbeat();if(!this.active)await this.pollOnce();} }catch(e){/* stay alive; retry */}await sleep(Math.max(900,Number(this.cfg.pollMs)||1600));}}
  stop(){this.running=false;}
  async heartbeat(){await requestJson('POST',apiUrl(this.cfg,'api/agent/heartbeat.php'),{version:this.version,platform:process.platform},headersFor(this.cfg),20000).catch(()=>null);}
  async pollOnce(){const r=await requestJson('GET',apiUrl(this.cfg,'api/agent/next.php'),null,headersFor(this.cfg),30000);if(!r?.job)return;this.active={id:r.job.id,type:r.job.type,cancelled:false};this.execute(r.job).finally(()=>{this.active=null;});}
  async postEvent(jobId,kind,payload={}){return requestJson('POST',apiUrl(this.cfg,'api/agent/event.php'),{jobId,kind,payload},headersFor(this.cfg),30000).catch(()=>null);}
  async complete(jobId,status,result=null,error=''){return requestJson('POST',apiUrl(this.cfg,'api/agent/complete.php'),{jobId,status,result,error},headersFor(this.cfg),60000).catch(()=>null);}
  async jobState(jobId){return requestJson('GET',apiUrl(this.cfg,`api/agent/state.php?id=${encodeURIComponent(jobId)}`),null,headersFor(this.cfg),20000).catch(()=>null);}
  handler(name){return this.handlers.get(name)||null;}
  fakeEvent(jobId,onSend){return {sender:{isDestroyed:()=>false,send:(channel,payload)=>{try{onSend?.(channel,payload);}catch(_){}}}};}
  async invoke(name,...args){const h=this.handler(name);if(!h)throw new Error(`Nexa handler no disponible: ${name}`);return h(this.fakeEvent('',()=>{}),...args);}
  async invokeWithEvent(name,jobId,payload,onSend){const h=this.handler(name);if(!h)throw new Error(`Nexa handler no disponible: ${name}`);return h(this.fakeEvent(jobId,onSend),payload);}
  async downloadAttachment(upload){const r=await requestBuffer('GET',apiUrl(this.cfg,`api/agent/download.php?id=${encodeURIComponent(upload.id)}`),{headers:headersFor(this.cfg),timeoutMs:180000});return {name:upload.name||'archivo',type:upload.mime||String(r.headers['content-type']||'application/octet-stream'),data:r.buffer.toString('base64')};}
  async stageAttachments(uploads){if(!Array.isArray(uploads)||!uploads.length)return'';const files=[];for(const up of uploads.slice(0,8))files.push(await this.downloadAttachment(up));const h=this.handler('chat-attachments:stage');if(!h)throw new Error('El sistema de adjuntos de Nexa no está disponible.');const staged=await h(this.fakeEvent('',()=>{}),{files});return staged?.token?markerForToken(staged.token):'';}
  async runChat(job){const p=job.payload||{};const marker=await this.stageAttachments(p.attachments||[]);const messages=(p.messages||[]).map(x=>({...x}));if(marker){for(let i=messages.length-1;i>=0;i--){if(messages[i].role==='user'){messages[i].content=String(messages[i].content||'')+marker;break;}}}
    let doneResolve,doneReject;const done=new Promise((res,rej)=>{doneResolve=res;doneReject=rej;});let latest='';
    const onSend=(channel,packet)=>{if(channel==='chat:token'){latest=String(packet?.content||latest);this.postEvent(job.id,'chat:token',{content:latest});}else if(channel==='chat:context')this.postEvent(job.id,'chat:context',{sources:packet?.sources||[]});else if(channel==='chat:done'){this.postEvent(job.id,'chat:done',{stats:packet?.stats||{}});doneResolve({content:latest,stats:packet?.stats||{}});}else if(channel==='chat:error'){doneReject(new Error(packet?.error||'Error de chat'));}};
    const payload={requestId:String(p.requestId||job.id),libraryIds:p.libraryIds||[],objectiveIds:p.objectiveIds||[],messages};const h=this.handler('chat:start');if(!h)throw new Error('chat:start no disponible.');
    const cancelTimer=setInterval(async()=>{const st=await this.jobState(job.id);if(st?.status==='cancel_requested'){clearInterval(cancelTimer);try{await this.invoke('chat:stop',payload.requestId);}catch(_){}doneReject(new Error('Cancelado por el usuario.'));}},1800);
    try{const startResult=await h(this.fakeEvent(job.id,onSend),payload);if(startResult?.ok===false)throw new Error(startResult.error||'No se pudo iniciar chat.');return await Promise.race([done,sleep(45*60*1000).then(()=>{throw new Error('Chat timeout ampliado.');})]);}finally{clearInterval(cancelTimer);}
  }
  async forgeGet(rel){return requestJson('GET',forgeUrl(this.cfg,rel),null,{},60000);}
  async forgePost(rel,body,timeout=30*60*1000){return requestJson('POST',forgeUrl(this.cfg,rel),body,{},timeout);}
  async forgeStatus(){
    try{const [opts,models,samplers,schedulers,upscalers]=await Promise.all([this.forgeGet('sdapi/v1/options'),this.forgeGet('sdapi/v1/sd-models'),this.forgeGet('sdapi/v1/samplers'),this.forgeGet('sdapi/v1/schedulers').catch(()=>[]),this.forgeGet('sdapi/v1/upscalers').catch(()=>[])]);return {ok:true,currentModel:opts?.sd_model_checkpoint||opts?.sd_checkpoint_hash||'',models:models||[],samplers:samplers||[],schedulers:schedulers||[],upscalers:upscalers||[]};}catch(e){return {ok:false,error:e.message,models:[],samplers:[],schedulers:[],upscalers:[]};}
  }
  async setForgeModel(model){if(!model)return;const opts=await this.forgeGet('sdapi/v1/options').catch(()=>({}));if(String(opts?.sd_model_checkpoint||'')===String(model))return;await this.forgePost('sdapi/v1/options',{sd_model_checkpoint:model},10*60*1000);}
  async uploadGenerated(buffer,name='image.png',mime='image/png'){const r=await uploadMultipart(apiUrl(this.cfg,'api/agent/upload.php'),headersFor(this.cfg),buffer,name,mime);if(!r?.url)throw new Error('Servidor web no devolvió URL de imagen.');return r.url;}
  async runForge(job){const p=job.payload||{};const status=await this.forgeStatus();if(!status.ok)throw new Error(`Forge offline: ${status.error||'sin respuesta'}`);if(p.model){await this.postEvent(job.id,'forge:progress',{label:`Cargando modelo ${p.model}…`});await this.setForgeModel(p.model);}
    const targetW=Math.max(64,Number(p.targetWidth)||Number(p.width)||1024),targetH=Math.max(64,Number(p.targetHeight)||Number(p.height)||1024);const width=Math.max(64,Math.min(1536,Number(p.width)||1024)),height=Math.max(64,Math.min(1536,Number(p.height)||1024));const isLarge=Math.max(targetW,targetH)>=3000;
    const availableUps=(status.upscalers||[]).map(x=>x.name);const upscaler=availableUps.includes(p.upscaler)?p.upscaler:(availableUps.find(x=>/R-ESRGAN|4x-Ultra|ESRGAN/i.test(x))||availableUps.find(x=>/Lanczos/i.test(x))||availableUps[0]||'Lanczos');
    const body={prompt:safeText(p.prompt,12000),negative_prompt:safeText(p.negativePrompt,8000),steps:Math.max(10,Math.min(60,Number(p.steps)||28)),cfg_scale:Math.max(1,Math.min(20,Number(p.cfg)||6.5)),width,height,sampler_name:p.sampler||'DPM++ 2M',scheduler:p.scheduler||'Karras',seed:Number.isFinite(Number(p.seed))?Number(p.seed):-1,batch_size:1,n_iter:1,enable_hr:Boolean(p.hires||isLarge),hr_scale:Number(p.hiresScale)||1.5,hr_upscaler:upscaler,denoising_strength:Math.max(0.05,Math.min(.8,Number(p.denoise)||.25))};
    await this.postEvent(job.id,'forge:progress',{label:`Forge generando ${width}×${height}${body.enable_hr?' + Hires Fix':''}…`});
    const cancelTimer=setInterval(async()=>{const st=await this.jobState(job.id);if(st?.status==='cancel_requested'){try{await this.forgePost('sdapi/v1/interrupt',{},30000);}catch(_){}clearInterval(cancelTimer);}},1800);
    try{const result=await this.forgePost('sdapi/v1/txt2img',body,45*60*1000);let image=Array.isArray(result?.images)?result.images[0]:'';if(!image)throw new Error('Forge no devolvió imagen.');let parsed=dataUrlToBuffer(image);if(!parsed)parsed={mime:'image/png',buffer:Buffer.from(image,'base64')};
      let finalBuffer=parsed.buffer,finalMime=parsed.mime||'image/png';
      if(targetW!==width||targetH!==height){await this.postEvent(job.id,'forge:progress',{label:`Upscale final ${targetW}×${targetH} con ${upscaler}…`});const extra=await this.forgePost('sdapi/v1/extra-single-image',{resize_mode:1,show_extras_results:true,gfpgan_visibility:0,codeformer_visibility:0,upscaling_resize:2,upscaling_resize_w:targetW,upscaling_resize_h:targetH,upscaling_crop:false,upscaler_1:upscaler,upscaler_2:'None',extras_upscaler_2_visibility:0,image:image},30*60*1000);const out=extra?.image||extra?.images?.[0];if(out){const pp=dataUrlToBuffer(out)||{mime:'image/png',buffer:Buffer.from(out,'base64')};finalBuffer=pp.buffer;finalMime=pp.mime;}}
      const url=await this.uploadGenerated(finalBuffer,`forge-${job.id}.${guessExt(finalMime)}`,finalMime);return {imageUrl:url,width:targetW,height:targetH,model:p.model||status.currentModel||'',summary:`Imagen generada con Forge · ${targetW}×${targetH} · ${p.model||status.currentModel||'modelo actual'}`};
    }finally{clearInterval(cancelTimer);}
  }
  async dashboard(){const invokeSafe=async(name,...args)=>{try{return await this.invoke(name,...args);}catch(e){return {ok:false,error:e.message};}};const [store,engine,system,knowledge,objectives,forge]=await Promise.all([invokeSafe('store:get'),invokeSafe('engine:status'),invokeSafe('system:stats'),invokeSafe('knowledge:list'),invokeSafe('knowledge-db:objectives'),this.forgeStatus()]);return {store,engine,system,knowledge,objectives,forge,agentConfig:{forgeBaseUrl:this.cfg.forgeBaseUrl,configPath:configPath()}};}
  async execute(job){
    try{await this.postEvent(job.id,'progress',{label:`Nexa local recibió: ${job.type}`});let result;
      switch(job.type){
        case'nexa.dashboard':result=await this.dashboard();break;
        case'chat.start':result=await this.runChat(job);break;
        case'forge.status':result=await this.forgeStatus();break;
        case'forge.generate':result=await this.runForge(job);break;
        case'store.chat.save':result=await this.invoke('store:chat:save',job.payload?.chat||{});break;
        case'store.chat.delete':result=await this.invoke('store:chat:delete',String(job.payload?.id||''));break;
        case'store.memory.save':result=await this.invoke('store:memory:save',job.payload?.memory||{});break;
        case'store.memory.delete':result=await this.invoke('store:memory:delete',String(job.payload?.id||''));break;
        case'store.settings':result=await this.invoke('store:settings',job.payload?.patch||{});break;
        case'knowledge.search':result=await this.invoke('knowledge:search',String(job.payload?.query||''),job.payload?.options||{});break;
        case'knowledge.list':result=await this.invoke('knowledge:list');break;
        case'engine.status':result=await this.invoke('engine:status');break;
        case'engine.start':result=await this.invoke('engine:start');break;
        case'engine.warm':result=await this.invoke('engine:warm');break;
        case'engine.unload':result=await this.invoke('engine:unload');break;
        case'agent.config':this.cfg={...this.cfg,...job.payload};saveConfig(this.cfg);result={ok:true,forgeBaseUrl:this.cfg.forgeBaseUrl,configPath:configPath()};break;
        default:throw new Error(`Comando web no soportado: ${job.type}`);
      }
      await this.complete(job.id,'done',result||{ok:true},'');
    }catch(e){const state=await this.jobState(job.id);const cancelled=state?.status==='cancel_requested';await this.complete(job.id,cancelled?'cancelled':'error',null,e.message||String(e));}
  }
}

module.exports={HostedWebAgent,VERSION,loadConfig,saveConfig,configPath,markerForToken,defaultConfig};
