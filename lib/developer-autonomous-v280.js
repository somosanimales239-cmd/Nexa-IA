'use strict';

/**
 * Nexa Developer Autonomous v2.8.0 (isolated Windows worker)
 * No global chat/model/UI changes, no runtime monkeypatch except the explicitly
 * installed developer.agent.* command interception.
 * Local Qwen2.5-Coder 7B proposes ONE bounded JSON action per iteration.
 * The host validates/executes actions against a private copy, never a source.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const {spawn} = require('child_process');

const MODEL = 'qwen2.5-coder:7b';
const VERSION = '2.8.0';
const MAX_STEPS = 36;
const MAX_SOURCE_FILES = 1500;
const MAX_EDIT_BYTES = 400 * 1024;
const MAX_CONTEXT_CHARS = 16000;
const MAX_ZIP_BYTES = 12 * 1024 * 1024;
const COPY_EXCLUDE = new Set(['.git','node_modules','vendor','.next','dist','build','release','coverage','.cache','.idea','.vscode','tmp','temp','.aider','__pycache__','uploads','private','sessions','logs']);
const SKIP_NAMES = new Set(['app.sqlite','.env','.env.local','.npmrc','credentials.json','secrets.json','id_rsa','id_ed25519']);
const SAFE_EXT = new Set(['.php','.js','.cjs','.mjs','.jsx','.ts','.tsx','.css','.html','.htm','.json','.md','.txt','.sql','.yml','.yaml','.py','.xml','.vue','.svelte','.ini','.htaccess']);
const ACTIVE = new Map();
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const cleanId = value => String(value||'run').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,70);
const textLimit = (v,n=2000) => String(v==null?'':v).slice(0,n);

function pathInside(parent, child) {
  const relative=path.relative(parent,child);
  return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));
}
function relativeSafe(value) {
  if(typeof value!=='string'||!value||value.includes('\0')||value.includes('\\')||path.posix.isAbsolute(value)||/^[a-zA-Z]:/.test(value))throw Error('Ruta no válida');
  const norm=path.posix.normalize(value);
  for(const seg of norm.split('/')){
    if(/[. ]$/.test(seg)||/[<>:\"|?*]/.test(seg)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(seg))throw Error('Nombre Windows bloqueado');
  }
  if(norm==='.'||norm==='..'||norm.startsWith('../')||value.split('/').some(x=>x==='..'||!x))throw Error('Ruta fuera del proyecto');
  if(!SAFE_EXT.has(path.posix.extname(norm).toLowerCase()) && path.posix.basename(norm)!=='.htaccess')throw Error('Extensión bloqueada: '+norm);
  const parts=norm.toLowerCase().split('/');
  if(parts.some(x=>COPY_EXCLUDE.has(x)||SKIP_NAMES.has(x)||x.startsWith('.env.')||x.startsWith('.aider')))throw Error('Archivo protegido: '+norm);
  return norm;
}
function safeFile(root,rel,mustExist=false) {
  const norm=relativeSafe(rel), full=path.join(root,...norm.split('/'));
  if(!pathInside(root,full))throw Error('Path traversal');
  let cursor=root;
  for(const part of norm.split('/')){
    cursor=path.join(cursor,part);
    if(fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink())throw Error('Enlace simbólico bloqueado');
  }
  if(mustExist&&(!fs.existsSync(full)||!fs.statSync(full).isFile()))throw Error('Archivo no existe: '+norm);
  return {norm,full};
}
function isAllowedSource(rel){try{relativeSafe(rel);return true;}catch(_){return false;}}
function makeSnapshot(source,dest,limits={}) {
  const maximum=limits.maxFiles||MAX_SOURCE_FILES;
  fs.mkdirSync(dest,{recursive:true});
  const files=new Map(); let total=0;
  const scan=(dir,depth=0)=>{
    if(depth>20)throw Error('Proyecto excede la profundidad permitida');
    for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      if(COPY_EXCLUDE.has(entry.name)||SKIP_NAMES.has(entry.name)||entry.name.startsWith('.env.')||entry.name.startsWith('.aider'))continue;
      const abs=path.join(dir,entry.name);
      if(entry.isSymbolicLink())continue;
      if(entry.isDirectory()){scan(abs,depth+1);continue;}
      if(!entry.isFile())continue;
      const rel=path.relative(source,abs).split(path.sep).join('/');
      if(!isAllowedSource(rel))continue;
      const stat=fs.statSync(abs);
      if(stat.size>MAX_EDIT_BYTES)continue;
      if(++total>maximum)throw Error('Proyecto demasiado grande: se necesitan filtros adicionales');
      const bytes=fs.readFileSync(abs);
      const target=safeFile(dest,rel).full;
      fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
      files.set(rel,{sha256:sha(bytes),size:bytes.length});
    }
  };
  scan(source);
  if(!files.size)throw Error('No hay archivos fuente de código admitidos para analizar');
  return files;
}
function fileCatalog(files) {
  return [...files.keys()].slice(0,300).map(x=>x).join('\n');
}
function balancedJSON(response) {
  const raw=String(response||'').trim();
  try{return JSON.parse(raw);}catch(_){}
  // Extract exactly one top-level object, ignoring fences and prose, if needed.
  for(let i=0;i<raw.length;i++){
    if(raw[i]!=='{')continue;
    let depth=0,inStr=false,esc=false;
    for(let j=i;j<raw.length;j++){
      const c=raw[j];if(inStr){if(esc)esc=false;else if(c==='\\')esc=true;else if(c==='"')inStr=false;continue;}
      if(c==='"'){inStr=true;continue;}
      if(c==='{')depth++;if(c==='}'){depth--;if(depth===0){try{return JSON.parse(raw.slice(i,j+1));}catch(_){break;}}}
    }
  }
  throw Error('Qwen no entregó JSON de acción válido');
}
function parseAction(value){
  const a=balancedJSON(value);
  if(!a||typeof a!=='object'||Array.isArray(a))throw Error('Acción inválida');
  const type=String(a.action||'').toLowerCase();
  if(!['read','replace','write','finish'].includes(type))throw Error('Acción no permitida: '+type);
  if(type==='read'||type==='replace'||type==='write')a.path=relativeSafe(a.path);
  if(type==='replace'){
    if(typeof a.find!=='string'||!a.find||typeof a.replace!=='string'||a.find.length>MAX_EDIT_BYTES||a.replace.length>MAX_EDIT_BYTES)throw Error('Reemplazo inválido');
  }
  if(type==='write'&&(typeof a.content!=='string'||Buffer.byteLength(a.content)>MAX_EDIT_BYTES))throw Error('Archivo demasiado grande');
  return {...a,action:type};
}
function workspaceEdit(root,a,changed){
  const item=safeFile(root,a.path,a.action==='replace');
  if(a.action==='replace'){
    const before=fs.readFileSync(item.full,'utf8');
    if(Buffer.byteLength(before)>MAX_EDIT_BYTES)throw Error('Archivo existente demasiado grande');
    const count=before.split(a.find).length-1;
    if(count!==1)throw Error(`Reemplazo ambiguo: se encontraron ${count} coincidencias`);
    const after=before.replace(a.find,a.replace);
    if(after===before)throw Error('El cambio no alteró el archivo');
    fs.writeFileSync(item.full+'.nexa-tmp',after,'utf8');fs.renameSync(item.full+'.nexa-tmp',item.full);
  }else{
    // No overwrites through write; use exact replace for an existing file.
    if(fs.existsSync(item.full))throw Error('write solo permite archivo NUEVO: usa replace para existentes');
    fs.mkdirSync(path.dirname(item.full),{recursive:true});
    fs.writeFileSync(item.full+'.nexa-tmp',a.content,'utf8');fs.renameSync(item.full+'.nexa-tmp',item.full);
  }
  changed.add(item.norm);
  return {path:item.norm,sha256:sha(fs.readFileSync(item.full)),size:fs.statSync(item.full).size};
}
function resultChanged(workspace,baseline) {
  const all=new Set(baseline.keys());
  const recursive=d=>{
    for(const e of fs.readdirSync(d,{withFileTypes:true})){
      if(e.isSymbolicLink())continue;
      const p=path.join(d,e.name);
      if(e.isDirectory()){recursive(p);continue;}
      const rel=path.relative(workspace,p).split(path.sep).join('/');
      if(isAllowedSource(rel))all.add(rel);
    }
  };
  recursive(workspace);
  const diff=[];
  for(const rel of [...all].sort()){
    const {full}=safeFile(workspace,rel);
    if(!fs.existsSync(full))continue;
    const b=fs.readFileSync(full),a=baseline.get(rel);
    if(!a||a.sha256!==sha(b))diff.push({path:rel,created:!a,size:b.length,sha256:sha(b)});
  }
  return diff;
}
function executable(name){return name;}
function runProgram(command,args,cwd,timeout=12000,externalSignal=null){
  return new Promise(resolve=>{
    let proc=null,done=false,out='',err='';
    const finish=(r)=>{if(done)return;done=true;clearTimeout(timer);externalSignal?.removeEventListener('abort',abort);resolve(r)};
    const abort=()=>{try{proc?.kill('SIGKILL');}catch(_){};finish({ok:false,exitCode:null,stderr:'Cancelado'})};
    let timer=setTimeout(()=>{try{proc?.kill('SIGKILL')}catch(_){}finish({ok:false,exitCode:null,stderr:'Timeout'})},timeout);
    if(externalSignal?.aborted)return abort();
    externalSignal?.addEventListener('abort',abort,{once:true});
    try{
      const winNpm=process.platform==='win32'&&command==='npm';
      proc=spawn(winNpm?'cmd.exe':executable(command),winNpm?['/d','/s','/c','npm test']:args,{cwd,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe'],env:{...process.env,CI:'true'}});
      proc.stdout.on('data',x=>{out=(out+x.toString('utf8')).slice(-7000)});
      proc.stderr.on('data',x=>{err=(err+x.toString('utf8')).slice(-7000)});
      proc.on('error',e=>finish({ok:false,exitCode:null,stderr:String(e.message)}));
      proc.on('close',code=>finish({ok:code===0,exitCode:code,stdout:out,stderr:err}));
    }catch(e){finish({ok:false,exitCode:null,stderr:String(e.message)})}
  });
}
async function verifyChanges(root,changed,signal){
  const checks=[];
  for(const f of changed){
    if(signal?.aborted)throw Error('Cancelado');
    const ext=path.extname(f).toLowerCase(); const command=ext==='.php'?'php':(['.js','.cjs','.mjs'].includes(ext)?'node':null);
    if(!command)continue;
    const args=command==='php'?['-l',f]:['--check',f];
    const r=await runProgram(command,args,root,12000,signal);
    checks.push({path:f,check:command==='php'?'php-lint':'node-check',ok:r.ok,exitCode:r.exitCode,output:textLimit((r.stdout||'')+' '+(r.stderr||''),550)});
  }
  return {checks,failed:checks.filter(x=>!x.ok),performed:checks.length};
}
async function runProjectTests(root,allowTests,signal){
  if(!allowTests)return {executed:0,passed:false,reason:'Pruebas funcionales no autorizadas; QA pendiente',checks:[]};
  // Only the pre-existing test script is used. This executes user-provided code;
  // the admin must opt in explicitly, on a disposable workspace.
  const file=path.join(root,'package.json');
  if(!fs.existsSync(file))return {executed:0,passed:false,reason:'Proyecto sin package.json para tests',checks:[]};
  let pkg;try{pkg=JSON.parse(fs.readFileSync(file,'utf8'))}catch(e){return {executed:0,passed:false,reason:'package.json inválido',checks:[]}}
  if(!pkg.scripts||typeof pkg.scripts.test!=='string')return {executed:0,passed:false,reason:'Proyecto sin npm test',checks:[]};
  const r=await runProgram('npm',['test'],root,90000,signal);
  return {executed:1,passed:r.ok,reason:r.ok?'npm test pasó':'npm test falló o no está instalado',checks:[{command:'npm test',ok:r.ok,exitCode:r.exitCode,output:textLimit((r.stdout||'')+' '+(r.stderr||''),3000)}]};
}
// ZIP store-only writer with own CRC32, for offline use without npm dependencies.
const crcTable=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(b){let c=0xffffffff;for(const v of b)c=crcTable[(c^v)&255]^(c>>>8);return(c^0xffffffff)>>>0}
function makeZip(entries){
  const chunks=[],cent=[],seen=new Set();let offset=0;
  for(const entry of entries){
    const name=relativeSafe(entry.path);
    if(seen.has(name))throw Error('Duplicado en ZIP');seen.add(name);
    const nb=Buffer.from(name,'utf8'),body=Buffer.from(entry.data),crc=crc32(body),u=body.length;
    if(nb.length>65535||u>MAX_EDIT_BYTES)throw Error('Entrada ZIP demasiado grande');
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(0,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(u,18);local.writeUInt32LE(u,22);local.writeUInt16LE(nb.length,26);
    chunks.push(local,nb,body);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt32LE(crc,16);central.writeUInt32LE(u,20);central.writeUInt32LE(u,24);central.writeUInt16LE(nb.length,28);central.writeUInt32LE(offset,42);cent.push(central,nb);
    offset+=local.length+nb.length+body.length;
    if(offset>MAX_ZIP_BYTES)throw Error('ZIP excede límite');
  }
  const cSize=cent.reduce((n,b)=>n+b.length,0);const foot=Buffer.alloc(22);foot.writeUInt32LE(0x06054b50,0);foot.writeUInt16LE(entries.length,8);foot.writeUInt16LE(entries.length,10);foot.writeUInt32LE(cSize,12);foot.writeUInt32LE(offset,16);
  return Buffer.concat([...chunks,...cent,foot]);
}
function deliverZip(root,changed,target){
  const entries=changed.map(c=>({path:c.path,data:fs.readFileSync(safeFile(root,c.path,true).full)}));
  const zip=makeZip(entries);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,zip);
  return {path:target,size:zip.length,sha256:sha(zip),fileCount:entries.length};
}
async function callOllama({model=MODEL,baseUrl='http://127.0.0.1:11434',messages,timeoutMs=75000,signal}){
  const url=new URL(baseUrl);if(!['127.0.0.1','localhost','::1'].includes(url.hostname)||!['http:'].includes(url.protocol))throw Error('Ollama solo permite loopback HTTP');
  const body=Buffer.from(JSON.stringify({model,messages,stream:false,options:{temperature:0,num_ctx:8192,num_predict:2200},keep_alive:'5m'}));
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:url.hostname,port:url.port||11434,path:'/api/chat',method:'POST',headers:{'Content-Type':'application/json','Content-Length':body.length}},res=>{
      let data='';res.on('data',x=>{data+=x.toString();if(data.length>3*1024*1024)req.destroy(Error('Respuesta Qwen excesiva'))});res.on('end',()=>{if(res.statusCode!==200)return reject(Error('Ollama HTTP '+res.statusCode+' '+data.slice(0,120)));try{const j=JSON.parse(data);resolve(String(j.message?.content||''));}catch(e){reject(Error('Respuesta Ollama inválida: '+e.message))}});
    });
    const abort=()=>req.destroy(Error('Cancelado'));
    if(signal?.aborted)return reject(Error('Cancelado'));
    signal?.addEventListener('abort',abort,{once:true});
    req.setTimeout(timeoutMs,()=>req.destroy(Error('Timeout Qwen')));
    req.on('error',e=>reject(e));req.on('close',()=>signal?.removeEventListener('abort',abort));req.end(body);
  });
}
const SYSTEM=[
  'Eres Nexa Developer. Modelo local qwen2.5-coder:7b. Código de proyecto real, no supongas archivos.',
  'Responde ÚNICAMENTE UN objeto JSON por turno, sin markdown ni explicación.',
  'Acciones: {"action":"read","path":"..."},',
  '{"action":"replace","path":"...","find":"fragmento EXACTO existente","replace":"nuevo fragmento"},',
  '{"action":"write","path":"archivo-nuevo.ext","content":"contenido completo"},',
  '{"action":"finish","summary":"...","needsMoreWork":false}.',
  'Los archivos originales NO se pueden tocar. Solo se escribe en copia privada. No usar herramientas inventadas.',
  'Usa read para inspeccionar los archivos antes de editar. Cada replace debe coincidir una sola vez.',
  'Solo se permite write en archivos nuevos. No elimines archivos. No uses código markdown.',
  'Si es una tarea compleja, trabaja en pasos pequeños y separados. No declares pruebas que no se ejecutaron.',
  'No solicites comandos de terminal ni ejecuciones directas. Si no puedes terminar, finish con needsMoreWork=true. Todo el resultado debe ser JSON válido.'
].join('\n');

async function runAgent({developer,payload,jobId,progress=()=>{},isCancelled=()=>false,ollama=callOllama,onPollCancel=null}){
  if(!developer?.assertRoot)throw Error('Runtime Developer incompatible');
  if(developer.config?.enabled!==true)throw Error('Developer Runtime desactivado');
  const source=developer.assertRoot(payload.root);
  const real=fs.realpathSync(source);
  const task=String(payload.task||'').trim();if(task.length<8||task.length>9000)throw Error('Tarea inválida');
  const maxSteps=Math.min(MAX_STEPS,Math.max(1,Number(payload.maxSteps)||MAX_STEPS));
  const workspaceBase=path.join(developer.baseDir,'autonomous-v280',cleanId(jobId));
  if(pathInside(real,workspaceBase)||pathInside(workspaceBase,real))throw Error('Origen y laboratorio superpuestos');
  if(fs.existsSync(workspaceBase))throw Error('ID de trabajo ya existe: usar un ID nuevo');
  const stage=path.join(workspaceBase,'workspace');
  const baseline=makeSnapshot(real,stage);
  const changed=new Set();const log=[];const ac=new AbortController();const started=Date.now();
  const stop=()=>{if(!ac.signal.aborted)ac.abort()};
  ACTIVE.set(jobId,{stop,started,stage});
  const ticker=setInterval(async()=>{
    if(isCancelled())return stop();
    if(onPollCancel){try{if(await onPollCancel())stop()}catch(_){}}
  },1500);ticker.unref?.();
  let status='incomplete',summary='',lastFeedback='Lee primero los archivos necesarios.',lastAction='',repeat=0,errors=0,repairAttempts=0;
  const event=(phase,label,detail={})=>{try{progress({phase,label,step:log.length,...detail})}catch(_){}};
  try{
    event('snapshot',`Copia aislada preparada: ${baseline.size} archivos`);
    for(let step=0;step<maxSteps;step++){
      if(ac.signal.aborted)throw Error('Cancelado');
      if(Date.now()-started>15*60*1000)throw Error('Límite global de 15 minutos');
      const catalog=fileCatalog(baseline);
      const history=log.slice(-8).map(x=>({action:x.action,path:x.path||'',ok:x.ok,detail:x.detail}));
      const prompt=[`TAREA: ${task}`,`PROYECTO: ${baseline.size} archivos originales`, `CATÁLOGO (primeros 300):\n${catalog}`,`CAMBIOS: ${[...changed].join(', ')||'ninguno'}`,`ÚLTIMAS ACCIONES: ${JSON.stringify(history)}`,`RESULTADO ANTERIOR: ${textLimit(lastFeedback,MAX_CONTEXT_CHARS)}`,`Paso ${step+1}/${maxSteps}. Responde UNA sola acción JSON.`].join('\n\n');
      event('thinking',`Qwen · paso ${step+1}/${maxSteps}`);
      let action;
      try{
        const response=await ollama({model:MODEL,baseUrl:payload.baseUrl||'http://127.0.0.1:11434',messages:[{role:'system',content:SYSTEM},{role:'user',content:prompt}],signal:ac.signal});
        action=parseAction(response);
      }catch(e){if(ac.signal.aborted)throw Error('Cancelado');errors++;lastFeedback='ERROR DE FORMATO: '+e.message+'; devuelve SOLO JSON de una acción.';event('invalid',lastFeedback);if(errors>=3)throw Error('Qwen falló 3 veces en formato o conexión');continue;}
      const fingerprint=sha(JSON.stringify(action));
      repeat=fingerprint===lastAction?repeat+1:0;lastAction=fingerprint;
      if(repeat>=2)throw Error('Qwen repitió la misma acción 3 veces; ciclo detenido');
      try{
        if(action.action==='finish'){
          summary=textLimit(action.summary||'',2000);
          if(action.needsMoreWork===true){status='incomplete';break;}
          if(changed.size===0){status='incomplete';summary='Qwen terminó sin cambios; no es una implementación.';break;}
          const verification=await verifyChanges(stage,[...changed],ac.signal);
          lastFeedback='Verificación: '+JSON.stringify(verification).slice(0,1200);
          if(verification.failed.length){
            repairAttempts++;
            if(repairAttempts>2){status='incomplete';summary='Agotadas dos reparaciones: persistieron errores de sintaxis.';break;}
            lastFeedback='ERROR DE SINTAXIS REAL: '+JSON.stringify(verification.failed).slice(0,2500)+'. Lee el archivo si es necesario, aplica una sola corrección exacta y vuelve a finalizar.';
            event('repair',`Reparación automática ${repairAttempts}/2`,{failed:verification.failed});
            log.push({action:'lint',ok:false,detail:lastFeedback});
            lastAction='';continue;
          }
          status='candidate';break;
        }
        if(action.action==='read'){
          const f=safeFile(stage,action.path,true);const b=fs.readFileSync(f.full);
          if(b.length>MAX_EDIT_BYTES)throw Error('Archivo demasiado grande');
          lastFeedback=`READ ${f.norm}, sha256=${sha(b)}:\n`+b.toString('utf8').slice(0,MAX_CONTEXT_CHARS);
        }else{
          const applied=workspaceEdit(stage,action,changed);
          lastFeedback=`EDIT OK ${JSON.stringify(applied)}; sigue con siguiente paso.`;
          event('edit',`Archivo modificado: ${action.path}`,{path:action.path});
        }
        log.push({action:action.action,path:action.path||'',ok:true,detail:textLimit(lastFeedback,200)});
      }catch(e){errors++;lastFeedback='ACCIÓN RECHAZADA: '+textLimit(e.message,500)+'; corrige tu siguiente acción.';log.push({action:action.action,path:action.path||'',ok:false,detail:lastFeedback});event('rejected',lastFeedback);if(errors>=6)throw Error('Demasiadas acciones inválidas: '+errors);}
    }
    const files=resultChanged(stage,baseline);
    const qa=await verifyChanges(stage,files.map(x=>x.path),ac.signal);
    const qaLevel=qa.failed.length?'failed_lint':qa.performed?'syntax_checked':'not_verified';
    if(qa.failed.length)status='incomplete';
    if(status==='candidate'&&qaLevel==='not_verified')status='incomplete';
    const projectTests=files.length&&qa.failed.length===0?await runProjectTests(stage,payload.allowTests===true,ac.signal):{executed:0,passed:false,reason:'Sintaxis fallida o sin cambios',checks:[]};
    let zip=null;
    // Deliver proposed changes as artifact even when incomplete; NOT a verified release.
    if(files.length&&!qa.failed.length)zip=deliverZip(stage,files,path.join(workspaceBase,'CHANGED_FILES_ONLY.zip'));
    const manifest={ok:status==='candidate',status:status==='candidate'?'review_required':status,finished:false,version:VERSION,model:MODEL,jobId,source:real,workspace:stage,task,summary,files,qa:{level:qaLevel,syntax:qa.checks,failed:qa.failed,testsExecuted:projectTests.executed,projectTests,regressionVerified:false,automatedFunctionalVerified:projectTests.passed},steps:log.length,errors,repairAttempts,zip:zip?{path:zip.path,size:zip.size,sha256:zip.sha256,fileCount:zip.fileCount}:null,disclaimer:'Un ZIP candidate NO se debe instalar sin QA funcional y revisión de seguridad.'};
    fs.writeFileSync(path.join(workspaceBase,'agent-report.json'),JSON.stringify(manifest,null,2));
    event('finished',`Resultado ${manifest.status}; archivos ${files.length}; sintaxis ${qaLevel}`);
    return manifest;
  }catch(e){
    const manifest={ok:false,status:ac.signal.aborted?'cancelled':'blocked',version:VERSION,jobId,workspace:stage,task,error:textLimit(e.message,500),steps:log.length,errors,report:'Proyecto original intacto; el trabajo solo ocurrió en copia.'};
    fs.writeFileSync(path.join(workspaceBase,'agent-report.json'),JSON.stringify(manifest,null,2));
    event('blocked',manifest.error);
    return manifest;
  }finally{clearInterval(ticker);ACTIVE.delete(jobId);}
}
function cancel(id){const job=ACTIVE.get(cleanId(id));if(!job)return{ok:false,error:'Trabajo no activo'};job.stop();return{ok:true,cancelled:true,jobId:id}}
function readArtifact(developer,payload={}) {
  if(!developer?.baseDir)throw Error('Runtime no disponible');
  const jobId=cleanId(payload.jobId||payload.id);
  const folder=path.join(developer.baseDir,'autonomous-v280',jobId);
  const report=path.join(folder,'agent-report.json');
  if(!fs.existsSync(report))throw Error('Artefacto no encontrado');
  const manifest=JSON.parse(fs.readFileSync(report,'utf8'));
  if(!manifest.zip||!manifest.zip.path)throw Error('Este trabajo no tiene ZIP de cambios');
  const filename=path.join(folder,'CHANGED_FILES_ONLY.zip');
  if(path.resolve(manifest.zip.path)!==path.resolve(filename)||!fs.existsSync(filename))throw Error('Ruta del artefacto inválida');
  const size=fs.statSync(filename).size;
  if(size>MAX_ZIP_BYTES||size!==manifest.zip.size)throw Error('Artefacto dañado');
  const partSize=240*1024,parts=Math.ceil(size/partSize);
  const index=Number(payload.part);
  if(!Number.isInteger(index)||index<0||index>=parts)throw Error('Fragmento de ZIP fuera de rango');
  const handle=fs.openSync(filename,'r');
  let buf;
  try {buf=Buffer.alloc(Math.min(partSize,size-index*partSize));fs.readSync(handle,buf,0,buf.length,index*partSize)}
  finally{fs.closeSync(handle)}
  return {ok:true,jobId,part:index,parts,size,sha256:manifest.zip.sha256,chunkSha256:sha(buf),chunkBase64:buf.toString('base64')};
}
async function probeOllama(baseUrl='http://127.0.0.1:11434') {
  try {
    const target=new URL(baseUrl);
    if(target.protocol!=='http:'||!['127.0.0.1','localhost','::1'].includes(target.hostname))return {online:false,available:false,error:'Solo HTTP local'};
    return await new Promise(resolve=>{
      const req=http.get({hostname:target.hostname,port:target.port||11434,path:'/api/tags',timeout:4500},res=>{
        let body='';res.on('data',c=>{body+=c.toString();if(body.length>1200000)req.destroy()});
        res.on('end',()=>{
          if(res.statusCode!==200)return resolve({online:false,available:false,error:'Ollama HTTP '+res.statusCode});
          try{const x=JSON.parse(body);const names=(x.models||[]).map(m=>String(m.name||m.model||''));resolve({online:true,available:names.includes(MODEL),model:MODEL});}
          catch(e){resolve({online:false,available:false,error:'Tags inválidos'});}
        });
      });
      req.on('timeout',()=>req.destroy());req.on('error',e=>resolve({online:false,available:false,error:String(e.message).slice(0,130)}));
    });
  }catch(e){return {online:false,available:false,error:String(e.message).slice(0,130)}}
}
function describe(developer){
  const base=developer?.capabilities?.()||{};
  return {...base,version:VERSION,runtimeVersion:String(base.version||'unknown'),autonomous:{loaded:true,version:VERSION,model:MODEL,isolatedWorkspace:true}};
}
function install(HostedWebAgent){
  if(!HostedWebAgent||HostedWebAgent.prototype.__nexaAutonomous280)return;
  const originalRun=HostedWebAgent.prototype.runDeveloper;
  const originalStatus=HostedWebAgent.prototype.runtimeStatus;
  const originalDashboard=HostedWebAgent.prototype.dashboard;
  const originalWatch=HostedWebAgent.prototype.watchActive;
  if(typeof originalRun!=='function')throw Error('Nexa HostedWebAgent no tiene runDeveloper');
  HostedWebAgent.prototype.runDeveloper=async function(job){
    const type=String(job.type||'');
    if(type==='developer.agent.status'){
      const probed=await probeOllama(this.developer?.config?.ai?.baseUrl||'http://127.0.0.1:11434');
      return {ok:true,agentLoaded:true,version:VERSION,runtimeVersion:String(this.developer?.capabilities?.()?.version||'unknown'),model:MODEL,ready:probed.online&&probed.available,ollama:probed,active:[...ACTIVE.keys()]};
    }
    if(type==='developer.agent.cancel')return cancel(job.payload?.id||job.payload?.jobId||job.id);
    if(type==='developer.agent.artifact')return readArtifact(this.developer,job.payload||{});
    if(type==='developer.capabilities')return describe(this.developer);
    if(type!=='developer.agent.run')return originalRun.call(this,job);
    const jobId=cleanId(job.id);
    return runAgent({developer:this.developer,payload:job.payload||{},jobId,progress:x=>this.postEvent(job.id,'developer:progress',x),isCancelled:()=>this.active?.releasing===true,onPollCancel:async()=>{
      const state=await this.jobState(job.id);
      return state?.status==='cancel_requested'||state?.status==='cancelled';
    }});
  };
  if(typeof originalStatus==='function')HostedWebAgent.prototype.runtimeStatus=async function(...args){
    const r=await originalStatus.apply(this,args);
    if(r&&typeof r==='object'){
      r.developer=describe(this.developer);
      r.agent={version:VERSION,model:MODEL,installed:true};
      if(typeof r.summary==='string')r.summary=r.summary.replace(/Developer (?:ready|off)/,`Developer ${r.developer.enabled?'ready':'off'} ${VERSION}`);
    }
    return r;
  };
  if(typeof originalDashboard==='function')HostedWebAgent.prototype.dashboard=async function(...args){
    const d=await originalDashboard.apply(this,args);if(d&&typeof d==='object')d.developer=describe(this.developer);return d;
  };
  // The existing watchdog uses a 3-minute cap for all unknown job types. The
  // autonomous coder itself has a 15-minute limit, so ONLY agent.run gets 17m.
  // All chat/image/watchdog paths remain unchanged.
  if(typeof originalWatch==='function')HostedWebAgent.prototype.watchActive=async function(...args){
    const a=this.active;
    if(a?.type!=='developer.agent.run')return originalWatch.apply(this,args);
    const age=Date.now()-Number(a.startedAt||Date.now());
    const state=await this.jobState(a.id).catch(()=>null);
    if(state){a.stateMisses=0;
      if(['cancel_requested','cancelled','error','done'].includes(String(state.status||'')))return this.releaseActive(a,'developer-'+state.status);
    }else{a.stateMisses=(a.stateMisses||0)+1;if(a.stateMisses>=5&&age>30000)return this.releaseActive(a,'developer-state-unreachable');}
    if(age>17*60*1000)return this.releaseActive(a,'developer-17m-hard-timeout');
  };
  Object.defineProperty(HostedWebAgent.prototype,'__nexaAutonomous280',{value:true});
}
module.exports={install,runAgent,cancel,readArtifact,parseAction,probeOllama,describe,relativeSafe,makeSnapshot,resultChanged,workspaceEdit,makeZip,deliverZip,verifyChanges,VERSION,MODEL};
