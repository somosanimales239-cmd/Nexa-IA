'use strict';
/**
 * Nexa Developer Web Control Bridge 3.0
 * The web owns planning, prompts, QA policy, retry and task state.
 * Windows performs only individually authorized, bounded operations.
 * Existing Hosted Web Agent chat/image/legacy Developer calls are untouched.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');
const {makeZip}=require('./developer-autonomous-v281');
const PROTOCOL='nexa-developer-web-control/3.0';
const MODEL='qwen2.5-coder:7b';
const MAX_FILES=2000,MAX_FILE=350*1024,MAX_ZIP=12*1024*1024,CHUNK=240*1024;
const EXTS=new Set(['.php','.js','.cjs','.mjs','.jsx','.ts','.tsx','.css','.html','.htm','.json','.md','.txt','.sql','.yml','.yaml','.py','.xml','.vue','.svelte','.ini','.htaccess']);
const IGNORE=new Set(['.git','node_modules','vendor','build','dist','release','.next','.cache','coverage','.idea','.vscode','logs','temp','tmp','private','uploads','sessions','__pycache__','.env','.npmrc','.ssh']);
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const finite=(value,fallback,min,max)=>Number.isFinite(Number(value))?Math.min(max,Math.max(min,Number(value))):fallback;
const within=(parent,child)=>{const relative=path.relative(parent,child);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};
function token(value){const s=String(value||'');if(!/^[a-zA-Z0-9_-]{5,64}$/.test(s))throw Error('ID de laboratorio inválido');return s;}
function safeRel(value){
  if(typeof value!=='string'||!value||value.length>380||value.includes('\\')||value.includes('\0')||value.startsWith('/')||/^[A-Za-z]:/.test(value))throw Error('Ruta de archivo inválida');
  const bits=value.split('/');if(bits.some(x=>!x||x==='.'||x==='..'||IGNORE.has(x.toLowerCase())||x.startsWith('.env')||/[<>:"|?*]/.test(x)||/[. ]$/.test(x)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x)))throw Error('Ruta protegida');
  if(!EXTS.has(path.posix.extname(value).toLowerCase())&&path.posix.basename(value)!=='.htaccess')throw Error('Extensión no autorizada');
  return value;
}
function safeDest(root,rel,exists=false){
  const s=safeRel(rel),file=path.join(root,...s.split('/'));
  if(!within(root,file))throw Error('Archivo fuera de laboratorio');
  let cur=root;
  for(const bit of s.split('/')){cur=path.join(cur,bit);if(fs.existsSync(cur)&&fs.lstatSync(cur).isSymbolicLink())throw Error('Symlink bloqueado');}
  if(exists&&(!fs.existsSync(file)||!fs.statSync(file).isFile()))throw Error('Archivo inexistente');
  return file;
}
function saveJson(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp-'+crypto.randomBytes(6).toString('hex');fs.writeFileSync(tmp,JSON.stringify(data,null,2));fs.renameSync(tmp,file);}
function readJson(file){if(!fs.existsSync(file))throw Error('Laboratorio no creado');return JSON.parse(fs.readFileSync(file,'utf8'));}
function rootOf(dev){if(!dev||typeof dev.baseDir!=='string')throw Error('Developer Runtime no disponible');const root=path.join(dev.baseDir,'web-control-v3');fs.mkdirSync(root,{recursive:true});return root;}
function paths(dev,id){const dir=path.join(rootOf(dev),token(id)),stage=path.join(dir,'workspace');return {dir,stage,manifest:path.join(dir,'manifest.json'),artifact:path.join(dir,'CHANGED_FILES_ONLY.zip')};}
function scan(root){
  const map={};let n=0;
  const walk=(dir,depth)=>{
    if(depth>22)throw Error('Profundidad máxima del proyecto excedida');
    for(const x of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      if(IGNORE.has(x.name.toLowerCase())||x.name.startsWith('.env'))continue;
      const p=path.join(dir,x.name);if(x.isSymbolicLink())continue;
      if(x.isDirectory()){walk(p,depth+1);continue;}
      if(!x.isFile())continue;
      const rel=path.relative(root,p).split(path.sep).join('/');
      try{safeRel(rel)}catch(_){continue;}
      if(++n>MAX_FILES)throw Error('Proyecto excede máximo de archivos');
      const s=fs.statSync(p);if(s.size>MAX_FILE)continue;
      const bytes=fs.readFileSync(p);map[rel]={sha256:sha(bytes),size:bytes.length};
    }
  };walk(root,0);return map;
}
function changes(manifest,stage){const now=scan(stage),result={};for(const [rel,meta] of Object.entries(now))if(!manifest.baseline[rel]||manifest.baseline[rel].sha256!==meta.sha256)result[rel]=meta;return result;}
function create(dev,arg){
  const source=dev.assertRoot(String(arg.sourceRoot||arg.root||''));const origin=fs.realpathSync(source);
  const id=token(arg.workspaceId||('lab_'+crypto.randomBytes(10).toString('hex'))),p=paths(dev,id);
  if(within(origin,p.dir)||within(p.dir,origin))throw Error('Workspace superpuesto con origen');
  if(fs.existsSync(p.manifest)||fs.existsSync(p.stage))throw Error('Workspace ya existe; usa un ID nuevo');
  fs.mkdirSync(p.stage,{recursive:true});let count=0;
  try{
    const visit=(dir,depth)=>{
      if(depth>22)throw Error('Carpetas demasiado profundas');
      for(const x of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
        if(IGNORE.has(x.name.toLowerCase())||x.name.startsWith('.env'))continue;
        const f=path.join(dir,x.name);if(x.isSymbolicLink())continue;
        if(x.isDirectory()){visit(f,depth+1);continue;}
        if(!x.isFile())continue;
        const rel=path.relative(origin,f).split(path.sep).join('/');
        try{safeRel(rel)}catch(_){continue;}
        const stat=fs.statSync(f);if(stat.size>MAX_FILE)continue;
        if(++count>MAX_FILES)throw Error('Máximo de archivos excedido');
        const out=safeDest(p.stage,rel);fs.mkdirSync(path.dirname(out),{recursive:true});fs.copyFileSync(f,out);
      }
    };visit(origin,0);
    const baseline=scan(p.stage);if(!Object.keys(baseline).length)throw Error('No hay archivos de texto admitidos en el proyecto');
    saveJson(p.manifest,{version:3,id,createdAt:new Date().toISOString(),sourceRoot:origin,baseline,events:[{kind:'workspace-created',files:Object.keys(baseline).length}]});
    return {ok:true,protocol:PROTOCOL,workspaceId:id,files:Object.keys(baseline).length,sourceUnchanged:true};
  }catch(e){fs.rmSync(p.dir,{recursive:true,force:true});throw e;}
}
function open(dev,id){const p=paths(dev,id),m=readJson(p.manifest);if(m.id!==token(id)||!fs.existsSync(p.stage))throw Error('Workspace inválido');return {p,m};}
function status(dev,id){const {p,m}=open(dev,id),delta=changes(m,p.stage);return{ok:true,workspaceId:m.id,files:Object.keys(m.baseline).length,changed:delta,edits:m.events.length,sourceUnchanged:true};}
function read(dev,arg){const {p,m}=open(dev,arg.workspaceId),rel=safeRel(arg.path),file=safeDest(p.stage,rel,true),buf=fs.readFileSync(file);return{ok:true,workspaceId:m.id,path:rel,sha256:sha(buf),size:buf.length,content:buf.toString('utf8').slice(0,Math.max(1000,Math.min(350000,Number(arg.maxChars)||120000)))};}
function lint(program,args,cwd,timeoutMs=18000){return new Promise(resolve=>{
  const proc=spawn(program,args,{cwd,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',done=false;
  const timer=setTimeout(()=>{proc.kill();if(!done){done=true;resolve({ok:false,verified:false,error:'Tiempo de verificación agotado'});}},timeoutMs);
  proc.on('error',e=>{if(done)return;done=true;clearTimeout(timer);resolve({ok:false,verified:false,error:'Linter no disponible: '+e.message});});
  for(const s of [proc.stdout,proc.stderr])s.on('data',b=>{output=(output+b).slice(-4500)});
  proc.on('close',code=>{if(done)return;done=true;clearTimeout(timer);resolve({ok:code===0,verified:true,error:code===0?'':output.slice(-1800),output:output.slice(-1800)});});
});}
async function check(p,rel){
  const filename=safeDest(p.stage,rel,true),ext=path.extname(rel).toLowerCase();
  if(ext==='.json'){try{JSON.parse(fs.readFileSync(filename,'utf8'));return{path:rel,kind:'json',verified:true,ok:true};}catch(e){return{path:rel,kind:'json',verified:true,ok:false,error:e.message}}}
  if(ext==='.php'||['.js','.cjs','.mjs'].includes(ext)){
    const program=ext==='.php'?'php':'node';const args=ext==='.php'?['-l',filename]:['--check',filename];
    return{path:rel,kind:ext==='.php'?'php-lint':'node-check',...(await lint(program,args,p.stage))};
  }
  return{path:rel,kind:'manual',verified:false,ok:null,error:'No existe verificador automático para este tipo de archivo'};
}
async function edit(dev,arg){
  const {p,m}=open(dev,arg.workspaceId),rel=safeRel(arg.path),action=String(arg.action||'replace');
  if(!['replace','create'].includes(action))throw Error('Solo replace/create mediante laboratorio; no append a ciegas');
  const filename=safeDest(p.stage,rel,action==='replace'),exists=fs.existsSync(filename);
  if(action==='create'&&exists)throw Error('Archivo existente: usa replace');
  if(action==='replace'&&!exists)throw Error('Archivo no existe: usa create');
  const before=exists?fs.readFileSync(filename):null;
  if(exists&&(!arg.expectedSha256||sha(before)!==arg.expectedSha256))throw Error('PRECONDITION_SHA: debes leer el archivo y proporcionar el hash actual');
  let next;
  if(action==='replace'){
    const original=before.toString('utf8'),find=String(arg.find??''),replacement=String(arg.replace??'');
    if(!find||original.split(find).length!==2)throw Error('ANCHOR_NON_UNIQUE: find debe aparecer exactamente una vez');
    next=Buffer.from(original.replace(find,replacement),'utf8');
  }else{if(typeof arg.content!=='string')throw Error('Contenido requerido');next=Buffer.from(arg.content,'utf8');}
  if(next.length>MAX_FILE)throw Error('Archivo demasiado grande');
  if(before&&sha(before)===sha(next))throw Error('NO_CHANGE: edición idéntica');
  if(before&&arg.rejectRepeated!==false){const candidate=String(arg.replace??'');if(candidate.length>24&&before.toString('utf8').includes(candidate))throw Error('DUPLICATE_GUARD: el bloque ya aparece');}
  fs.mkdirSync(path.dirname(filename),{recursive:true});const temp=filename+'.nexa-tx';
  try{
    fs.writeFileSync(temp,next);fs.renameSync(temp,filename);
    const qa=await check(p,rel);
    if(qa.verified===true&&qa.ok===false)throw Error('QA_REJECTED: '+qa.error);
    delete m.artifact;try{fs.rmSync(p.artifact,{force:true})}catch(_){}
    m.events.push({kind:'edit',path:rel,sha256:sha(next),qa:qa.kind,verified:qa.verified,at:new Date().toISOString()});
    if(m.events.length>3000)m.events=m.events.slice(-3000);
    saveJson(p.manifest,m);
    return{ok:true,workspaceId:m.id,path:rel,sha256:sha(next),qa,sourceUnchanged:true};
  }catch(e){if(before){fs.writeFileSync(filename+'.rollback',before);fs.renameSync(filename+'.rollback',filename);}else fs.rmSync(filename,{force:true});throw e;}
  finally{try{fs.rmSync(temp,{force:true})}catch(_){}}
}
async function qa(dev,id){const {p,m}=open(dev,id),delta=changes(m,p.stage),checks=[];
  for(const name of Object.keys(delta))checks.push(await check(p,name));
  const failed=checks.filter(x=>x.verified&&x.ok===false),pending=checks.filter(x=>!x.verified);
  return{ok:failed.length===0,workspaceId:id,changed:delta,checks,failed,pending,
    status:!Object.keys(delta).length?'no_changes':failed.length?'failed':pending.length?'review_required':'syntax_checked',functionalVerified:false,sourceUnchanged:true};
}
async function packageChanges(dev,id){const result=await qa(dev,id);if(result.failed.length||!Object.keys(result.changed).length)throw Error('No se puede empaquetar: QA falló o no existen modificaciones');
  const {p,m}=open(dev,id),entries=Object.keys(result.changed).map(name=>({path:name,data:fs.readFileSync(safeDest(p.stage,name,true))}));
  const body=makeZip(entries);if(body.length>MAX_ZIP)throw Error('ZIP supera límite 12 MB');fs.writeFileSync(p.artifact,body);
  const descriptor={size:body.length,sha256:sha(body),fileCount:entries.length};
  m.artifact=descriptor;m.events.push({kind:'package',...descriptor,at:new Date().toISOString()});saveJson(p.manifest,m);
  return{ok:true,workspaceId:id,status:'review_required',artifact:descriptor,qa:result,sourceUnchanged:true,notice:'ZIP sujeto a revisión funcional; no desplegar automáticamente'};
}
function artifact(dev,arg){const {p,m}=open(dev,arg.workspaceId);if(!m.artifact||!fs.existsSync(p.artifact))throw Error('No existe ZIP');
  const size=fs.statSync(p.artifact).size;if(size!==m.artifact.size)throw Error('Tamaño de ZIP inconsistente');
  const index=Number(arg.part||0),parts=Math.ceil(size/CHUNK);if(!Number.isInteger(index)||index<0||index>=parts)throw Error('Fragmento inválido');
  const buf=Buffer.alloc(Math.min(CHUNK,size-index*CHUNK)),handle=fs.openSync(p.artifact,'r');
  try{fs.readSync(handle,buf,0,buf.length,index*CHUNK)}finally{fs.closeSync(handle)}
  return{ok:true,workspaceId:m.id,part:index,parts,size,sha256:m.artifact.sha256,chunkSha256:sha(buf),chunkBase64:buf.toString('base64')};
}
function doctor(){
  const entries={};
  for(const [name,args] of [['node',['--version']],['php',['--version']],['git',['--version']]]){
    try{const r=spawnSync(name,args,{shell:false,windowsHide:true,encoding:'utf8',timeout:3000,maxBuffer:10000});entries[name]={installed:!r.error&&r.status===0,detail:r.error?String(r.error.code||r.error.message):String(r.stdout||r.stderr||'').split('\n')[0].slice(0,90)};}
    catch(e){entries[name]={installed:false,detail:String(e.message).slice(0,90)}}
  }
  try{const x=require('node:sqlite');entries.sqlite={installed:typeof x.DatabaseSync==='function',detail:'node:sqlite'};}
  catch(e){entries.sqlite={installed:false,detail:'node:sqlite no disponible'};}
  return entries;
}
function capabilities(dev){const base=dev.capabilities();return{ok:true,protocol:PROTOCOL,model:MODEL,webOwns:['prompts','planning','context','memory','limits','retry','evaluation','delivery','tracking','tool-selection'],
  executionTools:['ai.generate','file.list','file.read','semantic.index','semantic.search','git','sqlite.inspect','terminal','browser'],
  workspaceTools:['create','read','replace','create-file','status','qa','package','artifact'],
  isolatedWorkspace:true,supportedQAFiles:['.php','.js','.cjs','.mjs','.json'],settingsFromWeb:true,
  requiredExistingTools:base.tools||[],runtimeVersion:base.version||'unknown',allowedRoots:base.allowedRoots||[],
  modelInstalled:base.ai?.enabled===true,toolDiagnostics:doctor(),limits:{sourceFiles:MAX_FILES,fileBytes:MAX_FILE,zipBytes:MAX_ZIP},
  modelPolicy:'Developer exclusive qwen2.5-coder:7b; Chat/Image remain separate'};
}
async function execute(dev,type,payload={}){
  if(!dev||dev.config?.enabled!==true)throw Error('Developer Runtime no disponible');
  const op=String(type).replace(/^developer\.webv2\./,'');
  switch(op){
    case'capabilities':return capabilities(dev);
    case'workspace.create':return create(dev,payload);
    case'workspace.status':return status(dev,payload.workspaceId);
    case'workspace.read':return read(dev,payload);
    case'workspace.edit':return edit(dev,payload);
    case'workspace.qa':return qa(dev,payload.workspaceId);
    case'workspace.package':return packageChanges(dev,payload.workspaceId);
    case'workspace.artifact':return artifact(dev,payload);
    default:throw Error('Operación webv2 no permitida: '+op);
  }
}
function install(HostedWebAgent){
  if(!HostedWebAgent?.prototype?.runDeveloper)throw Error('HostedWebAgent incompatible');
  if(HostedWebAgent.prototype.__webV2ControlBridge)return;
  const original=HostedWebAgent.prototype.runDeveloper;
  HostedWebAgent.prototype.runDeveloper=async function(job){
    const type=String(job?.type||'');
    if(type.startsWith('developer.webv2.'))return execute(this.developer,type,job.payload||{});
    if(type==='developer.capabilities'){
      const originalResult=await original.call(this,job);
      return {...originalResult,webControlV3:capabilities(this.developer)};
    }
    if(type==='developer.ai.generate'){
      // The website supplies all generation parameters. Do not allow another
      // model to be silently substituted for the exclusive Developer coder.
      const model=String(job?.payload?.model||MODEL);
      if(model!==MODEL)throw Error('Developer Web usa exclusivamente '+MODEL);
    }
    return original.call(this,job);
  };
  HostedWebAgent.prototype.__webV2ControlBridge=true;
}
module.exports={install,execute,capabilities,safeRel,scan,PROTOCOL,MODEL};
