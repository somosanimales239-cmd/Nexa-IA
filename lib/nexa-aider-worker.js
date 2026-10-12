'use strict';
/**
 * Nexa Developer: independent, read-only Aider analyzer worker.
 * This module does NOT hook chat, image, Ollama, ipcMain or HostedWebAgent.
 * Only polls the dedicated /developer/aider-worker.php endpoint.
 * Does not invoke Aider chat. Runs a trusted bundled Python AST script in
 * the user's existing D:\LocalAI\Aider venv without importing any project.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const { spawn } = require('node:child_process');
const PROTOCOL = 'nexa-aider-symbols/v1';
const ENDPOINT = 'developer/aider-worker.php';
const PYTHON = 'D:\\LocalAI\\Aider\\.venv\\Scripts\\python.exe';
const SCRIPT = path.join(__dirname, 'nexa-aider-analyzer.py');
const MAX_BODY = 1_800_000;
const MAX_PY_STDOUT = 1_850_000;
const delay = ms=>new Promise(resolve=>setTimeout(resolve,ms));
function scrub(value){return String(value||'').replace(/[\r\n]/g,' ').slice(0,220);}
function selectServer(cfg={}){
  if(cfg.enabled!==true)return null;
  const secondary=String(cfg.developerWebServerUrl||'').replace(/\/+$/,'');
  const secondaryToken=String(cfg.developerWebAgentToken||'');
  const primary=String(cfg.serverUrl||'').replace(/\/+$/,'');
  const primaryToken=String(cfg.agentToken||'');
  // Prefer the explicit Developer Web endpoint when it is configured.
  if(/^https:\/\//i.test(secondary)&&secondaryToken.length>=20)return{base:secondary,token:secondaryToken};
  if(/^https:\/\//i.test(primary)&&primaryToken.length>=20)return{base:primary,token:primaryToken};
  return null;
}
function validateRemoteRoot(root, roots=['D:\\Projects']){
  if(process.platform!=='win32')throw Error('El Worker Aider requiere Windows');
  const raw=String(root||'');
  if(!/^[A-Za-z]:\\/.test(raw)||raw.includes('/')||/[\x00-\x1f]/.test(raw)||raw.length>700)throw Error('Ruta Windows inválida');
  if(raw.split('\\').some(s=>s==='.'||s==='..'||s===''))throw Error('Traversal o segmentos inválidos');
  const resolved=path.win32.resolve(raw);
  const normalized=resolved.toLowerCase();
  const allowed=roots.some(r=>{
    const safe=path.win32.resolve(r).toLowerCase().replace(/\\+$/,'');
    return normalized.startsWith(safe+'\\');
  });
  if(!allowed)throw Error('Proyecto no permitido: solo carpetas autorizadas');
  const real=fs.realpathSync.native(resolved);
  const realNorm=real.toLowerCase();
  // Ensure symlink/junction redirection cannot escape configured project root.
  if(!roots.some(r=>{
    const home=fs.realpathSync.native(r).toLowerCase().replace(/\\+$/,'');
    return realNorm.startsWith(home+'\\');
  }))throw Error('Junction o symlink sale de raíz autorizada');
  if(!fs.statSync(real).isDirectory())throw Error('La raíz no es un directorio');
  return real;
}
function requestJson(urlString,token,data,timeoutMs=30000){
  return new Promise((resolve,reject)=>{
    const body=Buffer.from(JSON.stringify(data),'utf8');
    if(body.length>MAX_BODY)return reject(Error('Informe supera límite seguro de la cola Web'));
    let url;try{url=new URL(urlString);}catch(e){return reject(e)}
    if(url.protocol!=='https:'||url.username||url.password||url.hash)return reject(Error('Solo endpoint HTTPS sin credenciales en URL'));
    const req=https.request(url,{method:'POST',headers:{'Content-Type':'application/json','X-Nexa-Agent-Token':token,'Content-Length':body.length},timeout:timeoutMs},res=>{
      if([301,302,303,307,308].includes(res.statusCode||0)){res.resume();return reject(Error('Redirección de endpoint bloqueada'));}
      let size=0;const chunks=[];
      res.on('data',v=>{size+=v.length;if(size>MAX_BODY){req.destroy(Error('Respuesta del servidor excesiva'));return;}chunks.push(v)});
      res.on('end',()=>{
        try{
          const out=JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if(res.statusCode!==200||!out||out.ok!==true)throw Error('Web '+res.statusCode+': '+scrub(out.error));
          resolve(out);
        }catch(e){reject(e)}
      });
      res.on('error',reject);
    });
    req.on('timeout',()=>req.destroy(Error('HTTP timeout')));
    req.on('error',reject);req.end(body);
  });
}
function runPython(executable,args,{timeoutMs=180000,maxOutput=MAX_PY_STDOUT}={}){
  return new Promise((resolve,reject)=>{
    let ended=false,out='',err='',proc;
    try{proc=spawn(executable,args,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1'}})}catch(e){return reject(e)}
    const timer=setTimeout(()=>{proc.kill();if(!ended){ended=true;reject(Error('Python Aider timeout'));}},timeoutMs);
    proc.stdout.on('data',b=>{out+=b.toString('utf8');if(Buffer.byteLength(out)>maxOutput)proc.kill()});
    proc.stderr.on('data',b=>{err=(err+b.toString('utf8')).slice(-2000)});
    proc.on('error',e=>{if(!ended){ended=true;clearTimeout(timer);reject(e)}});
    proc.on('close',code=>{
      if(ended)return;ended=true;clearTimeout(timer);
      if(code!==0)return reject(Error('Aider analyzer exit '+code+': '+scrub(err)));
      if(Buffer.byteLength(out)>maxOutput)return reject(Error('Resultado Aider excede límite de Web'));
      try{resolve(JSON.parse(out))}catch(_){reject(Error('Aider no devolvió JSON estructurado'))}
    });
  });
}
function getWorkerId(base){
  fs.mkdirSync(base,{recursive:true});const file=path.join(base,'aider-worker-id.txt');
  try{const saved=fs.readFileSync(file,'utf8').trim();if(/^[a-f0-9]{32}$/.test(saved))return saved;}catch(_){}
  const id=crypto.randomBytes(16).toString('hex');fs.writeFileSync(file,id,{mode:0o600,flag:'w'});return id;
}
class AiderWorker{
  constructor({loadConfig,configDir,allowedRoots=['D:\\Projects'],request=requestJson,python=runPython,logger=console}={}){
    if(typeof loadConfig!=='function'||typeof configDir!=='function')throw Error('Configuración Nexa faltante');
    this.loadConfig=loadConfig;this.configDir=configDir;this.allowedRoots=allowedRoots;
    this.request=request;this.python=python;this.log=logger;
    this.id=getWorkerId(configDir());this.running=false;this.state='idle';this.lastError='';
    this.materializedScript=null;
    this.lastProbe=null;this.probeTime=0;this.wait=10000;
  }
  ensureScript(){
    // Electron-builder normally stores lib/**/* in app.asar. CPython cannot open
    // a virtual asar path: materialize only this trusted, hash-verified script.
    const data=fs.readFileSync(SCRIPT);
    const digest=crypto.createHash('sha256').update(data).digest('hex');
    const dir=path.join(this.configDir(),'AiderWorker');
    const dest=path.join(dir,'nexa-aider-analyzer.py');
    fs.mkdirSync(dir,{recursive:true});
    let current='';try{current=crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex')}catch(_){}
    if(current!==digest){
      const tmp=dest+'.tmp-'+process.pid;fs.writeFileSync(tmp,data,{mode:0o600});fs.renameSync(tmp,dest);
    }
    this.materializedScript=dest;
    return dest;
  }
  async probe(){
    if(Date.now()-this.probeTime<60000&&this.lastProbe)return this.lastProbe;
    if(!fs.existsSync(PYTHON))throw Error('Aider no está instalado en D:');
    const script=this.ensureScript();
    const res=await this.python(PYTHON,[script,'--probe'],{timeoutMs:25000,maxOutput:5000});
    if(res.ok!==true||!res.version||!res.rootBound||!res.analysisOnly)throw Error('Aider Tree-sitter no está disponible');
    this.lastProbe=res;this.probeTime=Date.now();return res;
  }
  async handle(job){
    if(!job||job.type!=='developer.aider.analyze'||!/^nda_[a-f0-9]{32}$/.test(job.id||''))throw Error('Tipo o ID de job no permitido');
    const p=job.payload||{};
    if(p.protocol!==PROTOCOL||p.analysisOnly!==true||p.allowEdits!==false||p.includeSourceCode!==false)throw Error('Contrato de solo análisis inválido');
    const root=validateRemoteRoot(p.root,this.allowedRoots);
    const maxFiles=Math.min(300,Math.max(1,Number(p.maxFiles)||300));
    const maxSymbols=Math.min(120,Math.max(1,Number(p.maxSymbolsPerFile)||120));
    const offset=Number(p.offset||0);
    if(!Number.isInteger(offset)||offset<0||offset>12000)throw Error('Offset del proyecto inválido');
    const out=await this.python(PYTHON,[this.ensureScript(),'--root',root,'--offset',String(offset),'--max-files',String(maxFiles),'--max-symbols',String(maxSymbols)],{timeoutMs:180000});
    if(out.ok!==true||out.protocol!==PROTOCOL||out.analysisOnly!==true||!Array.isArray(out.files)||out.files.length>maxFiles)
      throw Error('Formato de análisis Aider inválido');
    if(path.win32.resolve(String(out.root||'')).toLowerCase()!==path.win32.resolve(root).toLowerCase())throw Error('Raíz del análisis no coincide');
    return out;
  }
  async cycle(){
    const settings=selectServer(this.loadConfig());
    if(!settings){this.state='not_configured';return;}
    const probed=await this.probe();
    const address=settings.base+'/'+ENDPOINT;
    await this.request(address,settings.token,{action:'hello',workerId:this.id,protocol:PROTOCOL,version:probed.version,available:true,analysisOnly:true,rootBound:true});
    const polled=await this.request(address,settings.token,{action:'next',workerId:this.id});
    if(!polled.job){this.state='ready';return;}
    this.state='analyzing';
    try{
      const result=await this.handle(polled.job);
      await this.request(address,settings.token,{action:'complete',workerId:this.id,jobId:polled.job.id,status:'done',result},30000);
      this.state='ready';
    }catch(e){
      this.state='failed';
      await this.request(address,settings.token,{action:'complete',workerId:this.id,jobId:polled.job.id,status:'error',error:scrub(e.message)}).catch(()=>{});
      throw e;
    }
  }
  start(){
    if(this.running)return;this.running=true;
    const loop=async()=>{
      while(this.running){
        try{await this.cycle();this.wait=10000;this.lastError='';}
        catch(e){this.lastError=scrub(e.message);this.wait=Math.min(60000,Math.max(15000,this.wait*1.5));this.log.warn('[Nexa Aider Developer only]',this.lastError)}
        if(this.running)await delay(this.wait);
      }
    };
    this.promise=loop();
  }
  stop(){this.running=false;}
}
module.exports={AiderWorker,PROTOCOL,selectServer,validateRemoteRoot,requestJson,runPython};
