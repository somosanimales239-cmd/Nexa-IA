'use strict';

/**
 * Nexa Developer Autonomous v2.8.1 (isolated Windows worker)
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
const VERSION = '2.8.1';
const MAX_STEPS = 36;
const MAX_SOURCE_FILES = 1500;
const MAX_EDIT_BYTES = 400 * 1024;
const MAX_CONTEXT_CHARS = 18000;
const BUILD_ID = 'nexa-agent-281-reliability-20261010';
const MAX_ZIP_BYTES = 12 * 1024 * 1024;
const REVIEW_ONLY_EXT=new Set(['.md','.txt','.htaccess','.css','.html','.htm','.xml','.yaml','.yml','.sql','.ini']);
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
  let a=balancedJSON(value);
  // Qwen 7B frequently uses operation/tool/file synonyms. Normalize only known
  // aliases into the same strictly checked operations; NEVER run model commands.
  if(a&&typeof a==='object'&&!Array.isArray(a)){
    if(Array.isArray(a.tool_calls)&&a.tool_calls.length===1){
      const f=a.tool_calls[0]?.function||a.tool_calls[0];
      let args=f?.arguments||{};if(typeof args==='string'){try{args=JSON.parse(args)}catch(_){args={}}}
      a={...args,action:f?.name||f?.tool||''};
    }
    const nested=a.arguments||a.parameters||a.params||a.input||a.args;
    if(nested&&typeof nested==='object'&&!Array.isArray(nested))a={...nested,...a};
  }
  if(!a||typeof a!=='object'||Array.isArray(a))throw Error('Acción JSON no es un objeto');
  const raw=String(a.action||a.operation||a.tool||a.type||'').trim().toLowerCase().replace(/[. -]/g,'_');
  const aliases={read_file:'read',file_read:'read',open_file:'read',view_file:'read',
    replace_text:'replace',file_replace:'replace',edit_file:'replace',patch_file:'replace',
    create_file:'write',write_file:'write',file_write:'write',
    append_file:'append',append_text:'append',append_line:'append',
    complete:'finish',done:'finish',final:'finish',list_files:'list',list_directory:'list'};
  const type=aliases[raw]||raw;
  if(!['list','read','replace','write','append','finish'].includes(type))throw Error('Acción no permitida: '+textLimit(raw,85)+'. Acciones válidas: list, read, replace, write, append, finish');
  a={...a,action:type};
  if(['read','replace','write','append'].includes(type))a.path=relativeSafe(a.path||a.file||a.file_path||a.filename);
  if(type==='replace'){
    a.find=a.find??a.old_text??a.search??a.old??a.original;
    a.replace=a.replace??a.new_text??a.replacement??a.new??a.updated;
    if(typeof a.find!=='string'||!a.find||typeof a.replace!=='string'||a.find.length>MAX_EDIT_BYTES||a.replace.length>MAX_EDIT_BYTES)throw Error('replace necesita find y replace como texto exacto');
  }
  if(type==='append'){
    a.content=a.content??a.text??a.line;
    if(typeof a.content!=='string'||!a.content||Buffer.byteLength(a.content)>MAX_EDIT_BYTES)throw Error('append necesita content o line como texto');
  }
  if(type==='write'){
    a.content=a.content??a.text??a.code;
    if(typeof a.content!=='string'||Buffer.byteLength(a.content)>MAX_EDIT_BYTES)throw Error('write necesita content como texto válido');
  }
  if(type==='read'){
    const n=Number(a.startLine??a.fromLine??a.line??1);
    a.startLine=Number.isInteger(n)&&n>0?Math.min(n,1000000):1;
  }
  return a;
}
function workspaceEdit(root,a,changed){
  const item=safeFile(root,a.path,a.action==='replace'||a.action==='append');
  if(a.action==='replace'){
    const before=fs.readFileSync(item.full,'utf8');
    if(Buffer.byteLength(before)>MAX_EDIT_BYTES)throw Error('Archivo existente demasiado grande');
    const count=before.split(a.find).length-1;
    if(count!==1)throw Error(`Reemplazo ambiguo: se encontraron ${count} coincidencias`);
    const after=before.replace(a.find,a.replace);
    if(after===before)throw Error('El cambio no alteró el archivo');
    fs.writeFileSync(item.full+'.nexa-tmp',after,'utf8');fs.renameSync(item.full+'.nexa-tmp',item.full);
  }else if(a.action==='append'){
    const before=fs.readFileSync(item.full,'utf8');
    if(Buffer.byteLength(before)>MAX_EDIT_BYTES)throw Error('Archivo grande: usa replace con fragmento específico');
    const chunk=String(a.content);
    if(before.endsWith(chunk))throw Error('El contenido ya está al final; no dupliques la línea');
    const after=before+((before&& !before.endsWith('\n') && !chunk.startsWith('\n'))?'\n':'')+chunk;
    if(Buffer.byteLength(after)>MAX_EDIT_BYTES)throw Error('Archivo excede límite');
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
    if(ext==='.json'){
      try{JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));checks.push({path:f,check:'json-parse',ok:true,exitCode:0,output:'JSON válido'});}
      catch(e){checks.push({path:f,check:'json-parse',ok:false,exitCode:1,output:textLimit(e.message,500)});}
      continue;
    }
    if(!command)continue;
    const args=command==='php'?['-l',f]:['--check',f];
    const r=await runProgram(command,args,root,12000,signal);
    const missingTool=!r.ok&&/\bENOENT\b|command not found|not recognized|no such file or directory/i.test(r.stderr||'');
    checks.push({path:f,check:command==='php'?'php-lint':'node-check',ok:r.ok&&!missingTool,skipped:missingTool,exitCode:r.exitCode,output:missingTool?'Linter no instalado: '+command:textLimit((r.stdout||'')+' '+(r.stderr||''),550)});
  }
  return {checks,failed:checks.filter(x=>!x.ok&&!x.skipped),performed:checks.filter(x=>!x.skipped).length};
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
  const body=Buffer.from(JSON.stringify({model,messages,stream:false,format:'json',options:{temperature:0,top_p:0.8,seed:7,num_ctx:12288,num_predict:3500},keep_alive:'5m'}));
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
  'Eres Nexa Developer. Usa SOLO qwen2.5-coder:7b en Ollama local.',
  'Eres un planificador de UNA acción JSON por respuesta. El HOST ejecuta todas las acciones; NO escribas bloques de código fuera de JSON.',
  'Acciones JSON válidas (una por respuesta):',
  '{"action":"list"} -> enumera archivos reales.',
  '{"action":"read","path":"README.md"} -> lee contenido exacto. Puedes pedir "startLine":20.',
  '{"action":"replace","path":"README.md","find":"fragmento exacto","replace":"nuevo fragmento"} -> edita un archivo existente.',
  '{"action":"append","path":"README.md","content":"línea nueva\n"} -> añade al final de un archivo existente.',
  '{"action":"write","path":"archivo-nuevo.php","content":"código completo"} -> crea SOLO un archivo que NO existe.',
  '{"action":"finish","summary":"resumen breve","needsMoreWork":false} -> termina SOLO después de cambios reales.',
  'Para una petición de AÑADIR AL FINAL usa read y después append; NO reescribas todo el archivo.',
  'Para editar código existente usa read y después replace con texto copiado EXACTAMENTE del archivo leído.',
  'En la salida READ el prefijo de número de línea (por ejemplo 1|) es una ayuda de lectura y NO es parte del archivo.',
  'NO inventes herramientas, comandos, rutas, resultados de tests, SQL ni archivos inexistentes.',
  'Si la acción es rechazada, usa el error REAL para corregir el siguiente JSON. No repitas un error.',
  'El HOST trabaja en una copia segura del proyecto; jamás toques el original.',
  'Si no puedes terminar, devuelve finish con needsMoreWork:true. RESPONDE EXCLUSIVAMENTE JSON.'
].join('\n');

function catalogForTask(files,task){
  const words=new Set(String(task).toLowerCase().match(/[a-z0-9_\-]{3,}/g)||[]);
  const paths=[...files.keys()];
  paths.sort((a,b)=>{
    const rank=x=>{
      const name=path.posix.basename(x).toLowerCase();
      let n=words.has(name)?30:0;
      for(const w of words)if(name.includes(w))n+=5;
      if(/^(readme|index|clientes|package|bootstrap)/.test(name))n+=1;
      return n;
    };
    return rank(b)-rank(a)||a.localeCompare(b);
  });
  return paths.slice(0,350).join('\n');
}
function readSnippet(file,startLine=1,maxChars=MAX_CONTEXT_CHARS){
  const content=fs.readFileSync(file,'utf8');
  const lines=content.split('\n');
  const start=Math.max(0,Math.min(lines.length-1,Number(startLine||1)-1));
  const out=[];let used=0;
  for(let i=start;i<lines.length;i++){
    const v=`${i+1}|${lines[i]}`;
    if(used+v.length>maxChars)break;
    out.push(v);used+=v.length+1;
  }
  return {content:out.join('\n'),firstLine:start+1,totalLines:lines.length,hasMore:start+out.length<lines.length};
}

async function runAgent({developer,payload,jobId,progress=()=>{},isCancelled=()=>false,ollama=callOllama,onPollCancel=null}){
  if(!developer?.assertRoot)throw Error('Runtime Developer incompatible');
  if(developer.config?.enabled!==true)throw Error('Developer Runtime desactivado');
  const source=developer.assertRoot(payload.root);
  const real=fs.realpathSync(source);
  const task=String(payload.task||'').trim();if(task.length<8||task.length>9000)throw Error('Tarea inválida');
  const maxSteps=Math.min(MAX_STEPS,Math.max(1,Number(payload.maxSteps)||MAX_STEPS));
  const workspaceBase=path.join(developer.baseDir,'autonomous-v281',cleanId(jobId));
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
  let status='incomplete',summary='',lastFeedback='Lee primero los archivos necesarios.',lastAction='',repeat=0,errors=0,invalidStreak=0,repairAttempts=0,lastRead='',invalidActions=[];
  const event=(phase,label,detail={})=>{try{progress({phase,label,step:log.length,...detail})}catch(_){}};
  try{
    event('snapshot',`Copia aislada preparada: ${baseline.size} archivos`);
    for(let step=0;step<maxSteps;step++){
      if(ac.signal.aborted)throw Error('Cancelado');
      if(Date.now()-started>15*60*1000)throw Error('Límite global de 15 minutos');
      const catalog=catalogForTask(baseline,task);
      const history=log.slice(-6).map(x=>({action:x.action,path:x.path||'',ok:x.ok,detail:x.detail}));
      const prompt=[`TAREA: ${task}`,`PROYECTO: ${baseline.size} archivos originales`, `CATÁLOGO (primeros 300):\n${catalog}`,`CAMBIOS: ${[...changed].join(', ')||'ninguno'}`,`ÚLTIMAS ACCIONES: ${JSON.stringify(history)}`,`ULTIMO ARCHIVO LEIDO: ${textLimit(lastRead,9500)}`,`RESULTADO ANTERIOR: ${textLimit(lastFeedback,12500)}`,`Paso ${step+1}/${maxSteps}. Responde UNA sola acción JSON.`].join('\n\n');
      event('thinking',`Qwen · paso ${step+1}/${maxSteps}`);
      let action;
      try{
        const response=await ollama({model:MODEL,baseUrl:payload.baseUrl||'http://127.0.0.1:11434',messages:[{role:'system',content:SYSTEM},{role:'user',content:prompt}],signal:ac.signal});
        action=parseAction(response);
      }catch(e){if(ac.signal.aborted)throw Error('Cancelado');errors++;invalidStreak++;lastFeedback='ERROR DE FORMATO: '+e.message+'; devuelve SOLO JSON de una acción.';invalidActions.push({step:step+1,error:textLimit(e.message,420),kind:'format'});log.push({action:'invalid-json',ok:false,detail:lastFeedback});event('invalid',lastFeedback);if(invalidStreak>=5)throw Error('Qwen falló cinco veces consecutivas en JSON; revisa el diagnóstico de acciones inválidas');continue;}
      const fingerprint=sha(JSON.stringify(action));
      repeat=fingerprint===lastAction?repeat+1:0;lastAction=fingerprint;
      if(repeat>=2)throw Error('Qwen repitió la misma acción 3 veces; ciclo detenido');
      try{
        if(action.action==='finish'){
          log.push({action:'finish',ok:true,detail:textLimit(action.summary||'Modelo solicitó terminar',350)});
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
        if(action.action==='list'){
          lastFeedback='ARCHIVOS REALES (usa read antes de editar):\n'+catalogForTask(baseline,task);
        }else if(action.action==='read'){
          const f=safeFile(stage,action.path,true);const b=fs.readFileSync(f.full);
          if(b.length>MAX_EDIT_BYTES)throw Error('Archivo demasiado grande');
          const excerpt=readSnippet(f.full,action.startLine||1);
          lastRead=`READ ${f.norm}, sha256=${sha(b)}, lines=${excerpt.totalLines}, first=${excerpt.firstLine}, hasMore=${excerpt.hasMore}:\n${excerpt.content}`;
          lastFeedback=lastRead;
        }else{
          const applied=workspaceEdit(stage,action,changed);
          lastFeedback=`EDIT OK ${JSON.stringify(applied)}; sigue con siguiente paso.`;
          event('edit',`Archivo modificado: ${action.path}`,{path:action.path});
        }
        invalidStreak=0;log.push({action:action.action,path:action.path||'',ok:true,detail:textLimit(lastFeedback,400)});
      }catch(e){errors++;invalidStreak++;lastFeedback='ACCIÓN RECHAZADA: '+textLimit(e.message,600)+'; corrige tu siguiente acción. Si vas a modificar un archivo existente usa read seguido de replace o append.';invalidActions.push({step:step+1,action:action.action,path:action.path||'',error:textLimit(e.message,420),kind:'tool'});log.push({action:action.action,path:action.path||'',ok:false,detail:lastFeedback});event('rejected',lastFeedback,{action:action.action,path:action.path||''});if(invalidStreak>=6)throw Error('Seis acciones inválidas CONSECUTIVAS; consulta agent-report.json para detalles');}
    }
    const files=resultChanged(stage,baseline);
    const qa=await verifyChanges(stage,files.map(x=>x.path),ac.signal);
    const qaLevel=qa.failed.length?'failed_lint':qa.performed?'syntax_checked':'not_verified';
    if(qa.failed.length)status='incomplete';
    if(status==='candidate'&&qaLevel==='not_verified' && files.some(f=>!REVIEW_ONLY_EXT.has(path.extname(f.path).toLowerCase())))status='incomplete';
    const finalQaLevel=qaLevel==='not_verified'&&files.every(f=>REVIEW_ONLY_EXT.has(path.extname(f.path).toLowerCase()))?'text_only_review':qaLevel;
    const projectTests=files.length&&qa.failed.length===0?await runProjectTests(stage,payload.allowTests===true,ac.signal):{executed:0,passed:false,reason:'Sintaxis fallida o sin cambios',checks:[]};
    let zip=null;
    // Deliver proposed changes as artifact even when incomplete; NOT a verified release.
    if(files.length&&!qa.failed.length)zip=deliverZip(stage,files,path.join(workspaceBase,'CHANGED_FILES_ONLY.zip'));
    const manifest={ok:status==='candidate',status:status==='candidate'?'review_required':status,finished:false,version:VERSION,buildId:BUILD_ID,model:MODEL,jobId,source:real,workspace:stage,task,summary,invalidActions,actionLog:log,files,qa:{level:finalQaLevel,syntax:qa.checks,failed:qa.failed,testsExecuted:projectTests.executed,projectTests,regressionVerified:false,automatedFunctionalVerified:projectTests.passed},steps:log.length,errors,repairAttempts,zip:zip?{path:zip.path,size:zip.size,sha256:zip.sha256,fileCount:zip.fileCount}:null,disclaimer:'Un ZIP candidate NO se debe instalar sin QA funcional y revisión de seguridad.'};
    fs.writeFileSync(path.join(workspaceBase,'agent-report.json'),JSON.stringify(manifest,null,2));
    event('finished',`Resultado ${manifest.status}; archivos ${files.length}; sintaxis ${qaLevel}`);
    return manifest;
  }catch(e){
    const files=resultChanged(stage,baseline);
    let zip=null;
    if(files.length){const q=await verifyChanges(stage,files.map(f=>f.path),ac.signal).catch(()=>({failed:[{error:'Lint unavailable'}]}));
      if(!q.failed.length)zip=deliverZip(stage,files,path.join(workspaceBase,'CHANGED_FILES_ONLY.zip'));}
    const manifest={ok:false,status:ac.signal.aborted?'cancelled':'blocked',finished:false,version:VERSION,buildId:BUILD_ID,model:MODEL,jobId,source:real,workspace:stage,task,error:textLimit(e.message,500),steps:log.length,errors,invalidActions,actionLog:log,files,zip:zip?{path:zip.path,size:zip.size,sha256:zip.sha256,fileCount:zip.fileCount}:null,report:'Proyecto original intacto; el trabajo solo ocurrió en copia.'};
    fs.writeFileSync(path.join(workspaceBase,'agent-report.json'),JSON.stringify(manifest,null,2));
    event('blocked',manifest.error);
    return manifest;
  }finally{clearInterval(ticker);ACTIVE.delete(jobId);}
}
function cancel(id){const job=ACTIVE.get(cleanId(id));if(!job)return{ok:false,error:'Trabajo no activo'};job.stop();return{ok:true,cancelled:true,jobId:id}}
function readReport(developer,payload={}){
  if(!developer?.baseDir)throw Error('Runtime no disponible');
  const jobId=cleanId(payload.jobId||payload.id);
  const file=path.join(developer.baseDir,'autonomous-v281',jobId,'agent-report.json');
  if(!fs.existsSync(file))throw Error('Reporte del trabajo no encontrado');
  const report=JSON.parse(fs.readFileSync(file,'utf8'));
  // Do not leak copies of code or the workspace contents through status calls.
  return {ok:true,jobId,version:VERSION,status:report.status,errors:report.errors||0,
    invalidActions:(report.invalidActions||[]).slice(-15),
    actionLog:(report.actionLog||[]).slice(-20).map(x=>({action:x.action,path:x.path||'',ok:x.ok,detail:textLimit(x.detail,500)})),
    files:(report.files||[]).map(x=>({path:x.path,sha256:x.sha256})),
    error:report.error||'',zip:report.zip?{size:report.zip.size,sha256:report.zip.sha256}:null};
}
function readArtifact(developer,payload={}) {
  if(!developer?.baseDir)throw Error('Runtime no disponible');
  const jobId=cleanId(payload.jobId||payload.id);
  const folder=path.join(developer.baseDir,'autonomous-v281',jobId);
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
  return {...base,version:VERSION,runtimeVersion:String(base.version||'unknown'),autonomous:{loaded:true,version:VERSION,buildId:BUILD_ID,model:MODEL,isolatedWorkspace:true}};
}
function install(HostedWebAgent){
  if(!HostedWebAgent||HostedWebAgent.prototype.__nexaAutonomous281)return;
  const originalRun=HostedWebAgent.prototype.runDeveloper;
  const originalStatus=HostedWebAgent.prototype.runtimeStatus;
  const originalDashboard=HostedWebAgent.prototype.dashboard;
  const originalWatch=HostedWebAgent.prototype.watchActive;
  if(typeof originalRun!=='function')throw Error('Nexa HostedWebAgent no tiene runDeveloper');
  HostedWebAgent.prototype.runDeveloper=async function(job){
    const type=String(job.type||'');
    if(type==='developer.agent.status'){
      const probed=await probeOllama(this.developer?.config?.ai?.baseUrl||'http://127.0.0.1:11434');
      return {ok:true,agentLoaded:true,version:VERSION,buildId:BUILD_ID,runtimeVersion:String(this.developer?.capabilities?.()?.version||'unknown'),model:MODEL,ready:probed.online&&probed.available,ollama:probed,active:[...ACTIVE.keys()]};
    }
    if(type==='developer.agent.cancel')return cancel(job.payload?.id||job.payload?.jobId||job.id);
    if(type==='developer.agent.artifact')return readArtifact(this.developer,job.payload||{});
    if(type==='developer.agent.report')return readReport(this.developer,job.payload||{});
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
      r.agent={version:VERSION,buildId:BUILD_ID,model:MODEL,installed:true};
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
  Object.defineProperty(HostedWebAgent.prototype,'__nexaAutonomous281',{value:true});
}
module.exports={install,runAgent,cancel,readArtifact,readReport,parseAction,probeOllama,describe,relativeSafe,makeSnapshot,resultChanged,workspaceEdit,makeZip,deliverZip,verifyChanges,VERSION,MODEL};
