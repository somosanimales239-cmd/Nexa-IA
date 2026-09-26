'use strict';

// Nexa AI v1.8.7 — Soft Review + Reference Consistency
// Extends the known-working v1.8.5 entrypoint. It does not replace the stable generator.

const fs=require('fs');
const path=require('path');
const http=require('http');
const {ipcMain,BrowserWindow,app}=require('electron');
const V187=require('./lib/visual-review-v187');

// App Builder active graph hint: this entry intentionally delegates the real window creation to main-v185.js/main.js.
const ACTIVE_ELECTRON_GRAPH={preload:path.join(__dirname,'preload.js'),renderer:path.join(__dirname,'src','index.html')};
function nexaActiveGraphHint(win){if(false&&win instanceof BrowserWindow)win.loadFile(path.join(__dirname,'src','index.html'));return ACTIVE_ELECTRON_GRAPH;}
void nexaActiveGraphHint;

const VERSION='1.8.7';
const OLLAMA='http://127.0.0.1:11434';
const originalVisual185=require('./lib/visual-review-v185');
// main-v185 will receive these upgraded functions through Node's shared module cache.
Object.assign(originalVisual185,V187);

function requestJson(method,urlString,body){
  return new Promise((resolve,reject)=>{
    const url=new URL(urlString); const payload=body==null?null:Buffer.from(JSON.stringify(body));
    const req=http.request({method,hostname:url.hostname,port:url.port||80,path:url.pathname+url.search,headers:payload?{'Content-Type':'application/json','Content-Length':payload.length}:{}},res=>{
      let raw='';res.setEncoding('utf8');res.on('data',c=>raw+=c);res.on('end',()=>{if(res.statusCode<200||res.statusCode>=300)return reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0,600)}`));try{resolve(raw.trim()?JSON.parse(raw):{});}catch(e){reject(e);}});
    }); req.on('error',reject); if(payload)req.write(payload); req.end();
  });
}
function extractJson(text){
  const s=String(text||'').trim(); const fence=s.match(/```(?:json)?\s*([\s\S]*?)```/i); const t=fence?fence[1]:s; const a=t.indexOf('{'),b=t.lastIndexOf('}');
  if(a<0||b<=a)return null; try{return JSON.parse(t.slice(a,b+1));}catch(_){return null;}
}
async function analyzeReferences(referenceConfig){
  const cfg=referenceConfig&&typeof referenceConfig==='object'?referenceConfig:{};
  const refs=Array.isArray(cfg.images)?cfg.images.filter(x=>x&&x.data).slice(0,4):[];
  if(!cfg.enabled||!refs.length)return null;
  const schema={type:'object',properties:{subject_type:{type:'string'},identity_traits:{type:'array',items:{type:'string'}},colors:{type:'array',items:{type:'string'}},markings:{type:'array',items:{type:'string'}},proportions:{type:'array',items:{type:'string'}},style_traits:{type:'array',items:{type:'string'}},composition_traits:{type:'array',items:{type:'string'}},preserve:{type:'array',items:{type:'string'}},avoid:{type:'array',items:{type:'string'}}},required:['subject_type','identity_traits','colors','markings','proportions','style_traits','composition_traits','preserve','avoid'],additionalProperties:false};
  const prompt=[
    'Analyze the uploaded reference image(s) for Nexa image consistency.',
    'Extract only visible, reusable Visual DNA. Do not identify real people.',
    `Mode: ${String(cfg.mode||'consistency')}.`,
    `Identity weight: ${Number(cfg.identityWeight)||85}/100. Style weight: ${Number(cfg.styleWeight)||60}/100. Composition weight: ${Number(cfg.compositionWeight)||45}/100.`,
    'If multiple references are provided, prioritize traits repeated across them.',
    'Return compact JSON only.'
  ].join(' ');
  const payload={model:'qwen2.5vl:3b',stream:false,keep_alive:'0s',format:schema,options:{temperature:0.05,num_ctx:4096,num_predict:320,num_gpu:0,repeat_penalty:1.18,repeat_last_n:128,top_p:0.85},messages:[{role:'user',content:prompt,images:refs.map(r=>String(r.data||''))}]};
  try{const r=await requestJson('POST',OLLAMA+'/api/chat',payload);return r?.message?.content?extractJson(r.message.content):null;}catch(_){return null;}
}

// Install a pre-handler before main-v185 captures ipcMain.handle. This lets us set reference context per image job.
const nativeHandle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=function(channel,listener){
  if(channel==='image:generate'){
    return nativeHandle(channel,async(event,payload={})=>{
      const refs=payload?.referenceConfig||null;
      let dna=null;
      if(refs?.enabled&&Array.isArray(refs.images)&&refs.images.length){
        try{
          if(event?.sender&&!event.sender.isDestroyed())event.sender.send('image:progress',{requestId:String(payload.requestId||''),phase:'reference-analysis',label:`Nexa Reference: analizando ${Math.min(4,refs.images.length)} imagen(es)…`});
          dna=await analyzeReferences(refs);
        }catch(_){dna=null;}
      }
      V187.setReferenceContext(refs?.enabled?{enabled:true,config:refs,dna:dna||{},count:Array.isArray(refs.images)?refs.images.length:0}:null);
      try{return await listener(event,payload);}finally{V187.clearReferenceContext();}
    });
  }
  if(channel==='store:get'){
    return nativeHandle(channel,async(...args)=>{const snapshot=await listener(...args);if(snapshot&&typeof snapshot==='object')snapshot.appVersion=VERSION;return snapshot;});
  }
  return nativeHandle(channel,listener);
};

// Load stable v1.8.5 visual pipeline and base app. It will capture the pre-handler above.
require('./main-v185');

function injectReferencePanel(win){
  try{
    const file=path.join(__dirname,'src','reference-panel-v187.js');
    const script=fs.readFileSync(file,'utf8');
    const apply=()=>win.webContents.executeJavaScript(script).catch(()=>{});
    win.webContents.on('did-finish-load',()=>setTimeout(apply,250));
    if(!win.webContents.isLoading())setTimeout(apply,250);
  }catch(_){}
}
app.on('browser-window-created',(_e,win)=>injectReferencePanel(win));
app.whenReady().then(()=>{for(const win of BrowserWindow.getAllWindows())injectReferencePanel(win);}).catch(()=>{});
