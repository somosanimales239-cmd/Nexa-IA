'use strict';

// Nexa AI v1.9.1 — Premium Web Intelligence
// User writes naturally -> Research Compiler -> multi-query web search -> source ranking -> evidence verification -> answer.

const fs=require('fs');
const path=require('path');
const {ipcMain,BrowserWindow,app}=require('electron');
const WebIntel=require('./lib/web-intelligence-v191');
const WebIntelRefine=require('./lib/web-intelligence-refinements-v192');

const VERSION='1.9.1';
let runtimeSettings={
  model:'gpt-oss:20b',baseUrl:'http://127.0.0.1:11434',profile:'fast',lightGpuLayers:6,keepAlive:'5m',
  internetResearchEnabled:true,autoResearchOnMissing:true,webMaxSources:5,
};

WebIntelRefine.install(WebIntel);
WebIntel.patchBrowserBridgeCapture();

const ACTIVE_ELECTRON_GRAPH={preload:path.join(__dirname,'preload.js'),renderer:path.join(__dirname,'src','index.html')};
function nexaActiveGraphHint(win){if(false&&win instanceof BrowserWindow)win.loadFile(path.join(__dirname,'src','index.html'));return ACTIVE_ELECTRON_GRAPH;}
void nexaActiveGraphHint;

function lastUserText(payload){
  const messages=Array.isArray(payload?.messages)?payload.messages:[];
  const message=[...messages].reverse().find(m=>m?.role==='user');
  return String(message?.content||'').replace(/\u2063\u2063[\u200B\u200C]+\u2064\u2064/g,'').trim();
}
function hasAttachmentMarker(payload){
  const messages=Array.isArray(payload?.messages)?payload.messages:[];
  return messages.some(m=>/\u2063\u2063[\u200B\u200C]+\u2064\u2064/.test(String(m?.content||'')));
}
function progress(event,requestId,phase,label,extra={}){
  try{if(event?.sender&&!event.sender.isDestroyed())event.sender.send('web-intelligence:progress',{requestId:String(requestId||''),phase,label,...extra});}catch(_){}
}
function mergeSources(a,b){
  const out=[],seen=new Set();
  for(const item of [...(Array.isArray(a)?a:[]),...(Array.isArray(b)?b:[])]){
    const key=String(item?.url||item?.path||item?.citation||JSON.stringify(item)).toLowerCase();
    if(seen.has(key))continue;seen.add(key);out.push(item);
  }
  return out.slice(0,40);
}

const nativeHandle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=function(channel,listener){
  if(channel==='store:get'){
    return nativeHandle(channel,async(...args)=>{
      const snapshot=await listener(...args);
      if(snapshot&&typeof snapshot==='object'){
        runtimeSettings={...runtimeSettings,...(snapshot.settings||{})};
        snapshot.appVersion=VERSION;
      }
      return snapshot;
    });
  }
  if(channel==='store:settings'){
    return nativeHandle(channel,async(event,patch)=>{
      const saved=await listener(event,patch);
      runtimeSettings={...runtimeSettings,...(saved||patch||{})};
      return saved;
    });
  }
  if(channel==='chat:start'){
    return nativeHandle(channel,async(event,payload={})=>{
      const requestId=String(payload.requestId||'');
      const question=lastUserText(payload);
      // Attachment messages belong to the v1.9.0 Vision/Document/Reference router. Do not steal them.
      if(!question||hasAttachmentMarker(payload))return listener(event,payload);
      const explicit=WebIntel.explicitWebRequest(question);
      const enabled=runtimeSettings.internetResearchEnabled!==false;
      const automatic=runtimeSettings.autoResearchOnMissing!==false;
      if(!enabled || (!automatic&&!explicit))return listener(event,payload);
      try{
        progress(event,requestId,'planning','Nexa Web: creando plan interno de investigación…');
        const research=await WebIntel.researchForChat(question,runtimeSettings,{progress:(phase,label)=>progress(event,requestId,phase,label)});
        if(!research.used){
          progress(event,requestId,'local','Nexa está escribiendo…');
          return listener(event,payload);
        }
        if(!research.sources.length){
          progress(event,requestId,'fallback','Nexa Web: no encontró evidencia utilizable; respondiendo sin afirmar verificación web.',{status:'INSUFFICIENT'});
          const failureContext={...payload,messages:[...(payload.messages||[]),{role:'system',content:'NEXA WEB NOTICE: A web search was attempted for this question but no usable sources were retrieved. Do not claim that current or exact facts were verified online. State uncertainty where appropriate.'}]};
          return listener(event,failureContext);
        }
        const outgoing=WebIntel.injectResearch(payload,question,research.plan,research.verification,research.sources);
        const webSources=WebIntel.sourceRecords(research.sources,research.verification);
        progress(event,requestId,'answering',`Nexa Web: ${research.sources.length} fuente${research.sources.length===1?'':'s'} preparada${research.sources.length===1?'':'s'} · respondiendo…`,{status:research.verification.status,confidence:research.verification.confidence});
        const result=await listener(event,outgoing);
        progress(event,requestId,'done','Nexa Web: investigación completada.',{status:research.verification.status,confidence:research.verification.confidence});
        return {...(result||{}),webIntelligence:{used:true,status:research.verification.status,confidence:research.verification.confidence,queries:research.plan.queries},sources:mergeSources(result?.sources,webSources)};
      }catch(error){
        progress(event,requestId,'fallback','Nexa Web: investigación no disponible; continuando con Nexa local.',{error:String(error?.message||error)});
        return listener(event,payload);
      }
    });
  }
  return nativeHandle(channel,listener);
};

function injectWebIntelligence(win){
  try{
    if(!win?.webContents)return;
    const file=path.join(__dirname,'src','web-intelligence-v191.js');
    const source=fs.readFileSync(file,'utf8');
    const apply=()=>win.webContents.executeJavaScript(source).catch(()=>{});
    win.webContents.on('did-finish-load',()=>setTimeout(apply,1100));
    if(!win.webContents.isLoading())setTimeout(apply,1100);
  }catch(_){}
}
app.on('browser-window-created',(_event,win)=>injectWebIntelligence(win));
app.whenReady().then(()=>{for(const win of BrowserWindow.getAllWindows())injectWebIntelligence(win);}).catch(()=>{});

require('./main-v190.js');
