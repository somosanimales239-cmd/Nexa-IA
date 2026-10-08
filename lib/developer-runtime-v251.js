'use strict';

// Nexa AI v2.5.1 — Local Developer Runtime · Windows execution stabilization
// Safe local tools for the Hosted Web Developer: filesystem, terminal,
// semantic code index, browser automation, persistent workflows, Git,
// database inspection/migrations and static security review.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const VERSION = '2.5.1';
const TEXT_EXTENSIONS = new Set([
  '.js','.cjs','.mjs','.jsx','.ts','.tsx','.php','.py','.html','.htm','.css','.scss','.less',
  '.json','.md','.txt','.sql','.yml','.yaml','.xml','.vue','.svelte','.java','.cs','.cpp','.c','.h'
]);
const INDEX_EXTENSIONS = new Set([
  '.js','.cjs','.mjs','.jsx','.ts','.tsx','.php','.py','.html','.htm','.css','.scss','.sql','.vue','.svelte'
]);
const DEFAULT_IGNORES = new Set([
  'node_modules','.git','.svn','.hg','release','dist','build','coverage','.next','.cache','.idea','.vscode',
  'vendor','tmp','temp','logs','__pycache__'
]);
const DEFAULT_COMMANDS = ['node','npm','php','composer','python','python3'];
const MAX_TEXT_FILE = 2 * 1024 * 1024;
const MAX_TERMINAL_OUTPUT = 300000;
const MAX_SCAN_FILES = 12000;

function nowIso(){ return new Date().toISOString(); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function cleanText(v,max=200000){ return String(v??'').replace(/\0/g,'').slice(0,max); }
function safeId(v){ return String(v||'job').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120)||'job'; }
function sha256(v){ return crypto.createHash('sha256').update(v).digest('hex'); }
function ensureDir(dir){ fs.mkdirSync(dir,{recursive:true}); return dir; }
function fileExists(file){ try{return fs.existsSync(file);}catch(_){return false;} }
function isFile(file){ try{return fs.statSync(file).isFile();}catch(_){return false;} }
function pathEntries(){ return String(process.env.PATH||process.env.Path||'').split(path.delimiter).map(x=>x.trim()).filter(Boolean); }
function windowsExtensions(){
  if(process.platform!=='win32')return [''];
  const raw=String(process.env.PATHEXT||'.COM;.EXE;.BAT;.CMD');
  const arr=raw.split(';').map(x=>x.trim().toLowerCase()).filter(Boolean);
  return ['',...arr];
}
function resolveOnPath(command){
  const raw=String(command||'').trim(); if(!raw||/[\\/]/.test(raw))return null;
  const hasExt=!!path.extname(raw);
  const names=hasExt?[raw]:windowsExtensions().map(ext=>raw+ext);
  for(const dir of pathEntries())for(const name of names){const full=path.join(dir,name);if(isFile(full))return full;}
  return null;
}
function hasCmdMeta(v){ const text=String(v||''); return ['\r','\n','&','|','<','>','^','%','!','"'].some(ch=>text.includes(ch)); }
function quoteCmdToken(v){ const t=String(v??''); if(hasCmdMeta(t))throw new Error('Argumento bloqueado para wrapper CMD seguro.'); return '"'+t+'"'; }
function readJson(file,fallback=null){ try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(_){return fallback;} }
function writeJsonAtomic(file,value){ ensureDir(path.dirname(file)); const tmp=file+'.tmp-'+process.pid+'-'+Date.now(); fs.writeFileSync(tmp,JSON.stringify(value,null,2)); fs.renameSync(tmp,file); }
function normalizePath(v){ return path.resolve(String(v||'').trim()); }
function lowerPlatform(v){ return process.platform==='win32'?String(v).toLowerCase():String(v); }
function realPathSafe(v){ try{return fs.realpathSync.native?fs.realpathSync.native(v):fs.realpathSync(v);}catch(_){return null;} }
function isSubPath(child,parent){
  const c=lowerPlatform(path.resolve(child));
  const p=lowerPlatform(path.resolve(parent));
  if(c===p)return true;
  return c.startsWith(p.endsWith(path.sep)?p:p+path.sep);
}
function extOf(file){ return path.extname(file).toLowerCase(); }
function relativePosix(root,file){ return path.relative(root,file).split(path.sep).join('/'); }
function lineNumberAt(text,index){ let n=1; for(let i=0;i<index&&i<text.length;i++)if(text.charCodeAt(i)===10)n++; return n; }
function truncateMiddle(text,max=500){ text=cleanText(text,max*2); if(text.length<=max)return text; const a=Math.floor(max*.7),b=max-a; return text.slice(0,a)+' … '+text.slice(-b); }
function safeChildEnv(){
  const blocked=/(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|AUTH|CREDENTIAL|COOKIE|SESSION|OPENAI|GITHUB|CLOVER)/i;
  const out={};
  for(const [k,v] of Object.entries(process.env||{})){if(!blocked.test(k)&&typeof v==='string')out[k]=v;}
  return out;
}
function redactSecrets(value){
  let text=String(value??'');
  const rules=[
    /\bsk-[A-Za-z0-9_-]{12,}/g,/\bgh[pousr]_[A-Za-z0-9]{12,}/g,/\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/gi,
    /((?:password|passwd|token|secret|api[_-]?key|authorization)\s*[:=]\s*["']?)[^\s"'&,;]{4,}/gi,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g
  ];
  for(const re of rules)text=text.replace(re,(m,p1)=>p1?String(p1)+'[REDACTED]':'[REDACTED_SECRET]');
  return text;
}
function isSensitiveFile(file){
  const base=path.basename(String(file||'')).toLowerCase();
  return base==='.env'||base.startsWith('.env.')||['.npmrc','.pypirc','credentials.json','secrets.json','id_rsa','id_ed25519'].includes(base)||/\.(?:pem|p12|pfx|key)$/i.test(base);
}
function sanitizeForStorage(value,key='',depth=0){
  if(depth>12)return '[TRUNCATED_DEPTH]';
  if(value==null||typeof value==='number'||typeof value==='boolean')return value;
  if(typeof value==='string'){
    if(/password|passwd|token|secret|authorization|cookie|api.?key|credential/i.test(key))return '[REDACTED_SECRET]';
    return redactSecrets(value).slice(0,120000);
  }
  if(Array.isArray(value))return value.slice(0,500).map(v=>sanitizeForStorage(v,key,depth+1));
  if(typeof value==='object'){
    const out={};for(const [k,v] of Object.entries(value)){
      if(k==='text'&&value.sensitive===true)out[k]='[REDACTED_SECRET]';
      else out[k]=sanitizeForStorage(v,k,depth+1);
    }return out;
  }
  return String(value);
}


function defaultRoots(baseDir){
  const roots=[path.join(baseDir,'Projects')];
  if(process.platform==='win32'){
    roots.push('D:\\LocalAI');
    roots.push('D:\\Projects');
    roots.push(path.join(os.homedir(),'Documents','NexaProjects'));
  }else{
    roots.push(path.join(os.homedir(),'NexaProjects'));
  }
  return [...new Set(roots.map(normalizePath))];
}

function defaultConfig(baseDir){
  return {
    version:VERSION,
    enabled:true,
    allowedRoots:defaultRoots(baseDir),
    ignoredDirectories:[...DEFAULT_IGNORES],
    terminal:{enabled:true,allowedCommands:[...DEFAULT_COMMANDS],timeoutMs:180000,maxOutput:MAX_TERMINAL_OUTPUT},
    browser:{enabled:true,maxSteps:50,timeoutMs:45000,persistSession:true,allowHttp:true,allowHttps:true},
    git:{enabled:true,networkEnabled:false},
    database:{inspectEnabled:true,migrationsEnabled:false,backupBeforeMigration:true},
    deploy:{enabled:false},
    security:{enabled:true},
    updatedAt:nowIso(),
  };
}

class DeveloperRuntime{
  constructor({baseDir=null,config=null}={}){
    this.baseDir=ensureDir(baseDir?normalizePath(baseDir):path.join(os.tmpdir(),'NexaDeveloperRuntime'));
    this.configFile=path.join(this.baseDir,'developer.json');
    this.jobsDir=ensureDir(path.join(this.baseDir,'jobs'));
    this.indexDir=ensureDir(path.join(this.baseDir,'indexes'));
    this.artifactsDir=ensureDir(path.join(this.baseDir,'artifacts'));
    this.backupsDir=ensureDir(path.join(this.baseDir,'backups'));
    this.config=config?this.mergeConfig(defaultConfig(this.baseDir),config):this.loadConfig();
    this.activeProcesses=new Map();
    this.activeBrowsers=new Map();
    this.cancelledJobs=new Set();
  }

  mergeConfig(base,patch){
    const out={...base,...(patch||{})};
    out.terminal={...base.terminal,...(patch?.terminal||{})};
    out.browser={...base.browser,...(patch?.browser||{})};
    out.git={...base.git,...(patch?.git||{})};
    out.database={...base.database,...(patch?.database||{})};
    out.deploy={...base.deploy,...(patch?.deploy||{})};
    out.security={...base.security,...(patch?.security||{})};
    out.allowedRoots=Array.isArray(patch?.allowedRoots)?patch.allowedRoots.map(normalizePath):base.allowedRoots;
    out.ignoredDirectories=Array.isArray(patch?.ignoredDirectories)?patch.ignoredDirectories.map(String):base.ignoredDirectories;
    return out;
  }

  loadConfig(){
    const base=defaultConfig(this.baseDir);
    const saved=readJson(this.configFile,null);
    const cfg=saved?this.mergeConfig(base,saved):base;
    if(!saved)writeJsonAtomic(this.configFile,cfg);
    return cfg;
  }

  saveConfig(){ this.config.updatedAt=nowIso(); writeJsonAtomic(this.configFile,this.config); }

  capabilities(){
    return {
      ok:true,version:VERSION,enabled:this.config.enabled===true,
      baseDir:this.baseDir,configPath:this.configFile,
      allowedRoots:this.config.allowedRoots,
      terminal:{enabled:this.config.terminal.enabled===true,allowedCommands:this.config.terminal.allowedCommands,commandAvailability:this.commandAvailability()},
      browser:{enabled:this.config.browser.enabled===true,engine:'Electron BrowserWindow',persistentSession:this.config.browser.persistSession!==false},
      semanticIndex:true,persistentJobs:true,resume:true,fileTools:true,
      git:{enabled:this.config.git.enabled===true,networkEnabled:this.config.git.networkEnabled===true,available:!!resolveOnPath('git')},
      database:{inspectEnabled:this.config.database.inspectEnabled===true,migrationsEnabled:this.config.database.migrationsEnabled===true},
      deploy:{enabled:this.config.deploy.enabled===true},securityScan:this.config.security.enabled===true,
      tools:[
        'developer.capabilities','developer.config','developer.file.list','developer.file.read','developer.file.write',
        'developer.file.replace','developer.file.mkdir','developer.file.delete','developer.semantic.index','developer.semantic.search',
        'developer.terminal.run','developer.browser.run','developer.security.scan','developer.db.inspect','developer.db.migrate',
        'developer.git.run','developer.workflow.run','developer.job.list','developer.job.status','developer.job.resume','developer.job.cancel'
      ]
    };
  }

  assertEnabled(){ if(this.config.enabled!==true)throw new Error('Developer Runtime está desactivado en developer.json.'); }
  allowedRoots(){ return (this.config.allowedRoots||[]).map(normalizePath); }
  assertAllowed(fileOrDir,{mustExist=false}={}){
    const target=normalizePath(fileOrDir);
    const root=this.allowedRoots().find(r=>isSubPath(target,r));
    if(!root)throw new Error(`Ruta fuera de Developer Allowed Roots: ${target}`);
    if(mustExist&&!fileExists(target))throw new Error(`Ruta no existe: ${target}`);
    // Defend against symlink/junction escapes: validate the real existing target,
    // or the nearest existing parent for paths that are about to be created.
    const rootReal=realPathSafe(root)||root;
    let probe=target;
    while(!fileExists(probe)){const parent=path.dirname(probe);if(parent===probe)break;probe=parent;}
    const probeReal=realPathSafe(probe)||probe;
    if(!isSubPath(probeReal,rootReal))throw new Error(`Ruta real sale de Developer Allowed Roots (symlink/junction): ${target}`);
    if(fileExists(target)){const targetReal=realPathSafe(target)||target;if(!isSubPath(targetReal,rootReal))throw new Error(`Ruta real sale de Developer Allowed Roots: ${target}`);}
    return target;
  }
  assertRoot(root){ const resolved=this.assertAllowed(root,{mustExist:true}); if(!fs.statSync(resolved).isDirectory())throw new Error(`Workspace no es directorio: ${resolved}`); return resolved; }

  updateConfig(patch={}){
    // Security-sensitive changes need an explicit acknowledgement from the Web admin.
    const sensitive=['allowedRoots','terminal','git','database','deploy','enabled'];
    if(sensitive.some(k=>Object.prototype.hasOwnProperty.call(patch,k)) && patch.confirm!=='ALLOW_NEXA_DEVELOPER_RUNTIME'){
      throw new Error('Cambio sensible bloqueado. Se requiere confirm="ALLOW_NEXA_DEVELOPER_RUNTIME".');
    }
    const clean={...patch}; delete clean.confirm;
    this.config=this.mergeConfig(this.config,clean);
    this.saveConfig();
    return this.capabilities();
  }

  shouldIgnore(name){ return new Set(this.config.ignoredDirectories||[]).has(String(name)); }

  walk(root,{extensions=null,maxFiles=MAX_SCAN_FILES}={}){
    root=this.assertRoot(root);
    const files=[]; const stack=[root];
    while(stack.length&&files.length<maxFiles){
      const dir=stack.pop(); let entries=[];
      try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch(_){continue;}
      for(const e of entries){
        if(files.length>=maxFiles)break;
        if(this.shouldIgnore(e.name))continue;
        const full=path.join(dir,e.name);
        if(e.isDirectory()){stack.push(full);continue;}
        if(!e.isFile())continue;
        if(extensions&&extensions.size&&!extensions.has(extOf(full)))continue;
        files.push(full);
      }
    }
    return files;
  }

  fileList(payload={}){
    const root=this.assertRoot(payload.root);
    const start=payload.path?this.assertAllowed(path.join(root,payload.path),{mustExist:true}):root;
    if(!isSubPath(start,root))throw new Error('Ruta solicitada fuera del workspace.');
    const recursive=payload.recursive===true;
    const limit=Math.max(1,Math.min(5000,Number(payload.limit)||1000));
    const out=[];
    const visit=(dir,depth)=>{
      let entries=[];try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch(_){return;}
      entries.sort((a,b)=>a.name.localeCompare(b.name));
      for(const e of entries){
        if(out.length>=limit)return;
        if(this.shouldIgnore(e.name))continue;
        const full=path.join(dir,e.name); let stat=null;try{stat=fs.statSync(full);}catch(_){continue;}
        out.push({path:relativePosix(root,full),type:e.isDirectory()?'dir':'file',size:e.isFile()?stat.size:0,modifiedAt:stat.mtime.toISOString()});
        if(recursive&&e.isDirectory()&&depth<30)visit(full,depth+1);
      }
    };
    if(fs.statSync(start).isDirectory())visit(start,0);else out.push({path:relativePosix(root,start),type:'file',size:fs.statSync(start).size});
    return {ok:true,root,items:out,truncated:out.length>=limit};
  }

  fileRead(payload={}){
    const root=this.assertRoot(payload.root); const file=this.assertAllowed(path.join(root,String(payload.path||'')),{mustExist:true});
    if(!isSubPath(file,root))throw new Error('Archivo fuera del workspace.');
    const stat=fs.statSync(file); if(!stat.isFile())throw new Error('La ruta no es un archivo.');
    if(isSensitiveFile(file)&&payload.confirmSensitive!=='ALLOW_SENSITIVE_FILE')throw new Error('Lectura de archivo sensible bloqueada. Se requiere confirmSensitive="ALLOW_SENSITIVE_FILE".');
    const max=Math.max(1,Math.min(4*1024*1024,Number(payload.maxBytes)||MAX_TEXT_FILE));
    if(stat.size>max)throw new Error(`Archivo demasiado grande (${stat.size} bytes). Límite ${max}.`);
    const data=fs.readFileSync(file); const ext=extOf(file);
    if(payload.encoding==='base64'||(!TEXT_EXTENSIONS.has(ext)&&payload.binary===true))return {ok:true,path:relativePosix(root,file),encoding:'base64',content:data.toString('base64'),size:stat.size,sha256:sha256(data)};
    if(!TEXT_EXTENSIONS.has(ext)&&payload.allowUnknownText!==true)throw new Error(`Tipo de archivo no habilitado para lectura textual: ${ext||'(sin extensión)'}`);
    return {ok:true,path:relativePosix(root,file),encoding:'utf8',content:data.toString('utf8'),size:stat.size,sha256:sha256(data)};
  }

  backupFile(root,file,reason='write'){
    if(!fileExists(file)||!fs.statSync(file).isFile())return null;
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const rel=relativePosix(root,file).replace(/[^a-zA-Z0-9._/-]/g,'_');
    const target=path.join(this.backupsDir,stamp+'-'+reason,rel);
    ensureDir(path.dirname(target)); fs.copyFileSync(file,target); return target;
  }

  fileWrite(payload={}){
    const root=this.assertRoot(payload.root); const file=this.assertAllowed(path.join(root,String(payload.path||'')));
    if(!isSubPath(file,root))throw new Error('Archivo fuera del workspace.');
    const ext=extOf(file); if(isSensitiveFile(file)&&payload.confirmSensitive!=='ALLOW_SENSITIVE_FILE')throw new Error('Escritura de archivo sensible bloqueada. Se requiere confirmSensitive="ALLOW_SENSITIVE_FILE".');
    if(payload.encoding!=='base64'&&!TEXT_EXTENSIONS.has(ext)&&payload.allowUnknownText!==true)throw new Error(`Tipo no permitido para escritura textual: ${ext||'(sin extensión)'}`);
    const existed=fileExists(file); const before=existed?fs.readFileSync(file):null;
    if(existed&&payload.expectedSha256&&sha256(before)!==String(payload.expectedSha256))throw new Error('Conflicto: el archivo cambió desde que fue leído (SHA-256 no coincide).');
    const backup=existed?this.backupFile(root,file,'write'):null;
    ensureDir(path.dirname(file));
    const body=payload.encoding==='base64'?Buffer.from(String(payload.content||''),'base64'):Buffer.from(String(payload.content??''),'utf8');
    const tmp=file+'.nexa-tmp-'+Date.now(); fs.writeFileSync(tmp,body); fs.renameSync(tmp,file);
    return {ok:true,path:relativePosix(root,file),created:!existed,size:body.length,sha256:sha256(body),backup:backup?relativePosix(this.baseDir,backup):null};
  }

  fileReplace(payload={}){
    const root=this.assertRoot(payload.root); const file=this.assertAllowed(path.join(root,String(payload.path||'')),{mustExist:true});
    if(!isSubPath(file,root))throw new Error('Archivo fuera del workspace.');
    if(isSensitiveFile(file)&&payload.confirmSensitive!=='ALLOW_SENSITIVE_FILE')throw new Error('Edición de archivo sensible bloqueada. Se requiere confirmSensitive="ALLOW_SENSITIVE_FILE".');
    const before=fs.readFileSync(file,'utf8'); const find=String(payload.find??'');
    if(!find)throw new Error('replace_text requiere find.');
    const count=before.split(find).length-1;
    if(count===0)throw new Error('Texto a reemplazar no encontrado.');
    if(payload.all!==true&&count!==1)throw new Error(`Cambio ambiguo: find aparece ${count} veces. Use all=true o un bloque más específico.`);
    const after=payload.all===true?before.split(find).join(String(payload.replace??'')):before.replace(find,String(payload.replace??''));
    const backup=this.backupFile(root,file,'replace'); fs.writeFileSync(file,after,'utf8');
    return {ok:true,path:relativePosix(root,file),replacements:payload.all===true?count:1,sha256:sha256(Buffer.from(after)),backup:backup?relativePosix(this.baseDir,backup):null};
  }

  fileMkdir(payload={}){
    const root=this.assertRoot(payload.root); const dir=this.assertAllowed(path.join(root,String(payload.path||''))); if(!isSubPath(dir,root))throw new Error('Ruta fuera del workspace.');
    ensureDir(dir); return {ok:true,path:relativePosix(root,dir)};
  }

  fileDelete(payload={}){
    const root=this.assertRoot(payload.root); const target=this.assertAllowed(path.join(root,String(payload.path||'')),{mustExist:true}); if(!isSubPath(target,root)||target===root)throw new Error('Eliminación bloqueada.');
    if(isSensitiveFile(target)&&payload.confirmSensitive!=='ALLOW_SENSITIVE_FILE')throw new Error('Eliminación de archivo sensible bloqueada. Se requiere confirmSensitive="ALLOW_SENSITIVE_FILE".');
    const stat=fs.statSync(target); let backup=null;
    if(stat.isFile())backup=this.backupFile(root,target,'delete');
    else if(payload.recursive!==true)throw new Error('Para borrar directorio se requiere recursive=true.');
    fs.rmSync(target,{recursive:stat.isDirectory(),force:false});
    return {ok:true,path:relativePosix(root,target),backup:backup?relativePosix(this.baseDir,backup):null};
  }

  extractSymbols(text,ext,rel){
    const symbols=[]; const deps=[]; const add=(kind,name,index,extra={})=>{if(name)symbols.push({kind,name:String(name).slice(0,180),line:lineNumberAt(text,index),...extra});};
    const matchAll=(re,cb)=>{let m;re.lastIndex=0;while((m=re.exec(text))!==null){cb(m);if(m.index===re.lastIndex)re.lastIndex++;}};
    if(['.js','.cjs','.mjs','.jsx','.ts','.tsx','.vue','.svelte'].includes(ext)){
      matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g,m=>add('function',m[1],m.index));
      matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g,m=>add('class',m[1],m.index));
      matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,m=>add('function',m[1],m.index));
      matchAll(/ipcMain\.(?:handle|on)\(\s*['"]([^'"]+)['"]/g,m=>add('ipc',m[1],m.index));
      matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g,m=>deps.push(m[1]));
      matchAll(/\bfrom\s+['"]([^'"]+)['"]/g,m=>deps.push(m[1]));
      matchAll(/\bimport\s+['"]([^'"]+)['"]/g,m=>deps.push(m[1]));
    }else if(ext==='.php'){
      matchAll(/\bfunction\s+([A-Za-z_][\w]*)\s*\(/gi,m=>add('function',m[1],m.index));
      matchAll(/\b(?:class|interface|trait)\s+([A-Za-z_][\w]*)/gi,m=>add('class',m[1],m.index));
      matchAll(/\b(?:require|require_once|include|include_once)\s*\(?\s*['"]([^'"]+)['"]/gi,m=>deps.push(m[1]));
      matchAll(/\$_SERVER\s*\[\s*['"]REQUEST_METHOD['"]\s*\]\s*===?\s*['"]([A-Z]+)['"]/g,m=>add('http-method',m[1],m.index));
    }else if(ext==='.py'){
      matchAll(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm,m=>add('function',m[1],m.index));
      matchAll(/^\s*class\s+([A-Za-z_]\w*)/gm,m=>add('class',m[1],m.index));
      matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm,m=>deps.push(m[1]||m[2]));
    }else if(ext==='.sql'){
      matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"\[]?([A-Za-z_][\w]*)/gi,m=>add('table',m[1],m.index));
      matchAll(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+[`"\[]?([A-Za-z_][\w]*)/gi,m=>add('index',m[1],m.index));
    }else if(['.html','.htm'].includes(ext)){
      matchAll(/\bid\s*=\s*['"]([^'"]+)['"]/gi,m=>add('dom-id',m[1],m.index));
      matchAll(/<form\b[^>]*>/gi,m=>add('form',`form@${lineNumberAt(text,m.index)}`,m.index));
    }else if(['.css','.scss','.less'].includes(ext)){
      matchAll(/(^|\})\s*([^@{}][^{]{0,180})\{/gm,m=>add('selector',m[2].trim(),m.index));
    }
    return {symbols:symbols.slice(0,2500),dependencies:[...new Set(deps)].slice(0,500)};
  }

  semanticIndex(payload={},hooks={}){
    const root=this.assertRoot(payload.root); const files=this.walk(root,{extensions:INDEX_EXTENSIONS,maxFiles:Math.min(MAX_SCAN_FILES,Number(payload.maxFiles)||MAX_SCAN_FILES)});
    const indexed=[]; let scanned=0;
    for(const file of files){
      if(hooks.isCancelled?.())throw new Error('Developer job cancelado.');
      let stat;try{stat=fs.statSync(file);}catch(_){continue;} if(stat.size>MAX_TEXT_FILE)continue;
      let text;try{text=fs.readFileSync(file,'utf8');}catch(_){continue;}
      const rel=relativePosix(root,file), ext=extOf(file); const {symbols,dependencies}=this.extractSymbols(text,ext,rel);
      indexed.push({path:rel,ext,size:stat.size,modifiedAt:stat.mtime.toISOString(),sha256:sha256(Buffer.from(text)),symbols,dependencies,preview:truncateMiddle(text.replace(/\s+/g,' '),360)});
      scanned++; if(scanned%50===0)hooks.progress?.({phase:'index',label:`Indexando código: ${scanned}/${files.length}`,files:scanned,total:files.length});
    }
    const graph={}; const byPath=new Set(indexed.map(f=>f.path));
    for(const f of indexed){
      const base=path.posix.dirname(f.path); const edges=[];
      for(const dep of f.dependencies){
        if(!dep.startsWith('.'))continue;
        const candidate=path.posix.normalize(path.posix.join(base,dep));
        for(const suffix of ['','.js','.cjs','.mjs','.ts','.tsx','.php','/index.js'])if(byPath.has(candidate+suffix)){edges.push(candidate+suffix);break;}
      }
      graph[f.path]=[...new Set(edges)];
    }
    const id=sha256(Buffer.from(lowerPlatform(root))).slice(0,20); const file=path.join(this.indexDir,id+'.json');
    const result={version:VERSION,root,createdAt:nowIso(),fileCount:indexed.length,files:indexed,graph}; writeJsonAtomic(file,result);
    hooks.progress?.({phase:'index-done',label:`Índice semántico listo: ${indexed.length} archivos`,files:indexed.length});
    return {ok:true,indexId:id,root,fileCount:indexed.length,symbolCount:indexed.reduce((n,f)=>n+f.symbols.length,0),dependencyEdges:Object.values(graph).reduce((n,a)=>n+a.length,0),indexPath:file};
  }

  loadIndex(payload={}){
    if(payload.indexId){const file=path.join(this.indexDir,safeId(payload.indexId)+'.json');const idx=readJson(file,null);if(idx)return idx;}
    if(payload.root){const id=sha256(Buffer.from(lowerPlatform(normalizePath(payload.root)))).slice(0,20);const idx=readJson(path.join(this.indexDir,id+'.json'),null);if(idx)return idx;}
    throw new Error('Índice semántico no encontrado. Ejecute developer.semantic.index primero.');
  }

  semanticSearch(payload={}){
    const idx=this.loadIndex(payload); const query=String(payload.query||'').trim(); if(!query)throw new Error('semantic.search requiere query.');
    const terms=query.toLowerCase().split(/[^a-z0-9_$.-]+/i).filter(Boolean); const scored=[];
    for(const f of idx.files||[]){
      let score=0; const p=f.path.toLowerCase(); const prev=String(f.preview||'').toLowerCase(); const symbolHits=[];
      for(const t of terms){if(p.includes(t))score+=8;if(prev.includes(t))score+=1;for(const s of f.symbols||[]){const n=String(s.name||'').toLowerCase();if(n===t){score+=18;symbolHits.push(s);}else if(n.includes(t)){score+=7;symbolHits.push(s);}}}
      if(score>0)scored.push({score,path:f.path,symbols:symbolHits.slice(0,20),dependencies:f.dependencies||[],preview:f.preview});
    }
    scored.sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path));
    return {ok:true,query,indexId:sha256(Buffer.from(lowerPlatform(idx.root))).slice(0,20),results:scored.slice(0,Math.max(1,Math.min(100,Number(payload.limit)||20)))};
  }

  commandAvailability(){
    const out={};
    for(const name of [...new Set([...(this.config.terminal.allowedCommands||[]),'git'])])out[String(name).toLowerCase()]=!!resolveOnPath(name);
    return out;
  }

  controlledSpawnSpec(command,args=[]){
    const resolved=resolveOnPath(command);
    if(!resolved)throw new Error(`Comando no instalado o no disponible en PATH: ${command}`);
    if(process.platform==='win32'&&/\.(?:cmd|bat)$/i.test(resolved)){
      // Windows cannot reliably spawn .cmd/.bat with shell:false on all Node/Electron builds.
      // Use cmd.exe only after rejecting command-shell metacharacters from every token.
      const comspec=process.env.ComSpec||process.env.COMSPEC||'C:\\Windows\\System32\\cmd.exe';
      if(!isFile(comspec)&&!resolveOnPath('cmd'))throw new Error('cmd.exe no está disponible para ejecutar wrapper .cmd/.bat.');
      const line=[resolved,...args].map(quoteCmdToken).join(' ');
      return {file:isFile(comspec)?comspec:(resolveOnPath('cmd')||'cmd.exe'),args:['/d','/s','/c',line],resolved};
    }
    return {file:resolved,args:[...args],resolved};
  }

  runControlledProcess({cwd,command,args=[],timeoutMs,maxOutput,jobId},hooks={}){
    const spec=this.controlledSpawnSpec(command,args);
    const timeout=Math.max(1000,Math.min(30*60*1000,Number(timeoutMs)||Number(this.config.terminal.timeoutMs)||180000));
    const outLimit=Math.max(1000,Math.min(2*1024*1024,Number(maxOutput)||Number(this.config.terminal.maxOutput)||MAX_TERMINAL_OUTPUT));
    const id=safeId(jobId||hooks.jobId||crypto.randomUUID());
    return new Promise((resolve,reject)=>{
      const started=Date.now(); let stdout='',stderr='',settled=false,timer=null;
      let child; try{child=spawn(spec.file,spec.args,{cwd,windowsHide:true,shell:false,env:{...safeChildEnv(),CI:process.env.CI||'false'}});}catch(e){return reject(e);}
      this.activeProcesses.set(id,child);
      const append=(which,data)=>{const str=redactSecrets(Buffer.from(data).toString('utf8'));if(which==='out')stdout=(stdout+str).slice(-outLimit);else stderr=(stderr+str).slice(-outLimit);hooks.progress?.({phase:'terminal',label:truncateMiddle(str.trim(),220),stream:which==='out'?'stdout':'stderr'});};
      child.stdout?.on('data',d=>append('out',d)); child.stderr?.on('data',d=>append('err',d));
      child.on('error',err=>{if(settled)return;settled=true;clearTimeout(timer);this.activeProcesses.delete(id);reject(err);});
      child.on('close',(code,signal)=>{if(settled)return;settled=true;clearTimeout(timer);this.activeProcesses.delete(id);resolve({ok:code===0,command:String(command),args:[...args],cwd,executable:spec.resolved,exitCode:code,signal:signal||null,durationMs:Date.now()-started,stdout,stderr});});
      timer=setTimeout(()=>{if(settled)return;try{child.kill();}catch(_){};settled=true;this.activeProcesses.delete(id);reject(new Error(`Terminal timeout después de ${timeout} ms.`));},timeout);
    });
  }

  normalizeCommand(command){
    const raw=String(command||'').trim(); if(!raw)throw new Error('terminal.run requiere command.');
    if(/[\\/]/.test(raw))throw new Error('Use un comando permitido por nombre, no una ruta arbitraria al ejecutable.');
    const name=raw.toLowerCase().replace(/\.(exe|cmd|bat)$/,'');
    const allowed=(this.config.terminal.allowedCommands||[]).map(x=>String(x).toLowerCase());
    if(!allowed.includes(name))throw new Error(`Comando no permitido: ${raw}. Permitidos: ${allowed.join(', ')}`);
    return name;
  }

  validateCommandArgs(command,args,cwd){
    const name=String(command).toLowerCase().replace(/\.(exe|cmd|bat)$/,'');
    const a=(args||[]).map(String);
    const forbiddenInline=new Set(['-e','--eval','-p','--print','-r','--require','-c','--command']);
    if(['node','python','python3','php'].includes(name)&&a.some(x=>forbiddenInline.has(String(x).toLowerCase())))
      throw new Error(`Terminal bloqueó ejecución inline (${name}). Use un archivo/script dentro del workspace.`);
    if(name==='npm'){
      const first=String(a[0]||'').toLowerCase();
      if(!['test','run','run-script','exec','version','view','list','ls','outdated'].includes(first))
        throw new Error(`npm ${first||'(sin acción)'} no está permitido por el perfil seguro.`);
      if(first==='exec')throw new Error('npm exec está bloqueado por defecto; puede descargar/ejecutar código arbitrario.');
    }
    if(name==='composer'){
      const first=String(a[0]||'').toLowerCase();
      if(!['validate','test','run-script','install','update','show','outdated','audit'].includes(first))
        throw new Error(`composer ${first||'(sin acción)'} no está permitido por el perfil seguro.`);
    }
    // Script arguments that look like local paths must resolve inside the cwd/allowed roots.
    if(['node','python','python3','php'].includes(name)){
      const script=a.find(x=>x && !x.startsWith('-'));
      if(script){
        const candidate=path.isAbsolute(script)?script:path.resolve(cwd,script);
        if(fileExists(candidate))this.assertAllowed(candidate,{mustExist:true});
      }
    }
    return a;
  }

  runTerminal(payload={},hooks={}){
    this.assertEnabled(); if(this.config.terminal.enabled!==true)throw new Error('Terminal Developer desactivada.');
    const cwd=this.assertAllowed(payload.cwd||payload.root,{mustExist:true}); if(!fs.statSync(cwd).isDirectory())throw new Error('cwd no es directorio.');
    const command=this.normalizeCommand(payload.command); const args=this.validateCommandArgs(command,Array.isArray(payload.args)?payload.args.map(x=>String(x)):[],cwd);
    return this.runControlledProcess({cwd,command,args,timeoutMs:payload.timeoutMs,maxOutput:payload.maxOutput,jobId:payload.jobId},hooks);
  }

  browserAllowedUrl(raw){
    const url=new URL(String(raw||''));
    if(url.protocol==='https:'&&this.config.browser.allowHttps!==false)return url;
    if(url.protocol==='http:'&&this.config.browser.allowHttp!==false)return url;
    throw new Error(`Protocolo de navegador no permitido: ${url.protocol}`);
  }

  async browserRun(payload={},hooks={}){
    this.assertEnabled(); if(this.config.browser.enabled!==true)throw new Error('Browser Developer desactivado.');
    const { BrowserWindow, session } = require('electron');
    const startUrl=this.browserAllowedUrl(payload.url); const jobId=safeId(payload.jobId||hooks.jobId||crypto.randomUUID());
    const partition=this.config.browser.persistSession===false?undefined:'persist:nexa-developer-browser';
    if(payload.cleanSession===true&&partition){try{await session.fromPartition(partition).clearStorageData();}catch(_){}}
    const win=new BrowserWindow({show:false,width:Math.max(640,Number(payload.width)||1440),height:Math.max(480,Number(payload.height)||1000),webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,partition}});
    this.activeBrowsers.set(jobId,win); const logs=[]; const failures=[]; const artifacts=[];
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('console-message',(_event,details)=>{const level=details?.level||'info';const message=details?.message||'';logs.push({level,message:cleanText(message,1200),source:details?.sourceId||'',line:details?.lineNumber||0});});
    win.webContents.on('did-fail-load',(_e,code,desc,url,isMain)=>{if(isMain!==false)failures.push({code,description:desc,url});});
    const waitLoad=(timeout=45000)=>new Promise((resolve,reject)=>{let done=false;const finish=(err)=>{if(done)return;done=true;clearTimeout(timer);win.webContents.removeListener('did-finish-load',onOk);win.webContents.removeListener('did-fail-load',onFail);err?reject(err):resolve();};const onOk=()=>finish();const onFail=(_e,code,desc,_url,isMain)=>{if(isMain!==false)finish(new Error(`Browser load failed ${code}: ${desc}`));};const timer=setTimeout(()=>finish(new Error('Browser navigation timeout.')),timeout);win.webContents.once('did-finish-load',onOk);win.webContents.once('did-fail-load',onFail);});
    const exec=async(fn,args=[])=>win.webContents.executeJavaScript(`(${fn})(${args.map(a=>JSON.stringify(a)).join(',')})`,true);
    const screenshot=async(name='browser.png')=>{const image=await win.webContents.capturePage();const file=path.join(this.artifactsDir,`${jobId}-${safeId(name)}`);fs.writeFileSync(file,image.toPNG());artifacts.push({type:'image',name:path.basename(file),mime:'image/png',path:file,size:fs.statSync(file).size});return file;};
    try{
      hooks.progress?.({phase:'browser',label:`Abriendo ${startUrl.href}`}); const loaded=waitLoad(Number(payload.timeoutMs)||this.config.browser.timeoutMs); await win.loadURL(startUrl.href); await loaded;
      const steps=Array.isArray(payload.steps)?payload.steps:[]; if(steps.length>Math.min(100,Number(this.config.browser.maxSteps)||50))throw new Error('Demasiados pasos de Browser Agent.');
      const results=[];
      for(let i=0;i<steps.length;i++){
        if(this.cancelledJobs.has(jobId)||hooks.isCancelled?.())throw new Error('Developer browser job cancelado.');
        const step=steps[i]||{}; const action=String(step.action||'').toLowerCase(); hooks.progress?.({phase:'browser-step',label:`Browser ${i+1}/${steps.length}: ${action}`,step:i+1,total:steps.length});
        if(action==='wait'){await sleep(Math.max(0,Math.min(30000,Number(step.ms)||500)));results.push({action,ok:true});continue;}
        if(action==='goto'){const u=this.browserAllowedUrl(step.url);const l=waitLoad(Number(step.timeoutMs)||45000);await win.loadURL(u.href);await l;results.push({action,ok:true,url:win.webContents.getURL()});continue;}
        if(action==='click'){
          const r=await exec((sel)=>{const el=document.querySelector(sel);if(!el)return {ok:false,error:'selector-not-found'};el.scrollIntoView({block:'center',inline:'center'});el.click();return {ok:true,tag:el.tagName,text:(el.innerText||el.value||'').slice(0,300)};},[String(step.selector||'')]); if(!r.ok)throw new Error(`click: ${r.error} ${step.selector}`); results.push({action,...r}); continue;
        }
        if(action==='type'){
          const r=await exec((sel,value,clear)=>{const el=document.querySelector(sel);if(!el)return {ok:false,error:'selector-not-found'};el.focus();if(clear)el.value='';el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true};},[String(step.selector||''),String(step.text??''),step.clear!==false]); if(!r.ok)throw new Error(`type: ${r.error} ${step.selector}`); results.push({action,...r}); continue;
        }
        if(action==='select'){
          const r=await exec((sel,value)=>{const el=document.querySelector(sel);if(!el)return {ok:false,error:'selector-not-found'};el.value=String(value);el.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true,value:el.value};},[String(step.selector||''),String(step.value??'')]); if(!r.ok)throw new Error(`select: ${r.error} ${step.selector}`); results.push({action,...r}); continue;
        }
        if(action==='press'){
          const key=String(step.key||'Enter');await win.webContents.sendInputEvent({type:'keyDown',keyCode:key});await win.webContents.sendInputEvent({type:'keyUp',keyCode:key});results.push({action,ok:true,key});continue;
        }
        if(action==='waitfor'){
          const selector=String(step.selector||''),timeout=Math.max(100,Math.min(60000,Number(step.timeoutMs)||10000)),started=Date.now();let found=false;
          while(Date.now()-started<timeout){found=await exec(sel=>Boolean(document.querySelector(sel)),[selector]);if(found)break;await sleep(250);}if(!found)throw new Error(`waitFor timeout: ${selector}`);results.push({action,ok:true,selector});continue;
        }
        if(action==='asserttext'){
          const r=await exec((sel,needle)=>{const el=sel?document.querySelector(sel):document.body;if(!el)return {ok:false,error:'selector-not-found'};const text=(el.innerText||el.textContent||'');return {ok:text.includes(needle),sample:text.slice(0,1200)};},[String(step.selector||''),String(step.contains||'')]);if(!r.ok)throw new Error(`assertText falló: ${step.contains}`);results.push({action,ok:true});continue;
        }
        if(action==='asserturl'){const current=win.webContents.getURL();if(!current.includes(String(step.contains||'')))throw new Error(`assertUrl falló. URL actual: ${current}`);results.push({action,ok:true,url:current});continue;}
        if(action==='extract'){
          const r=await exec((sel,attr)=>{const els=[...document.querySelectorAll(sel)].slice(0,200);return els.map(el=>attr?el.getAttribute(attr):(el.innerText||el.textContent||el.value||'').trim().slice(0,2000));},[String(step.selector||'body'),step.attribute?String(step.attribute):'']);results.push({action,ok:true,values:r});continue;
        }
        if(action==='screenshot'){const file=await screenshot(step.name||`step-${i+1}.png`);results.push({action,ok:true,artifact:path.basename(file)});continue;}
        throw new Error(`Acción Browser Agent no soportada: ${action}`);
      }
      if(payload.screenshot!==false&&!artifacts.length)await screenshot(payload.screenshotName||'final.png');
      const page=await exec(()=>({title:document.title,url:location.href,text:(document.body?.innerText||'').slice(0,12000),forms:document.forms.length,links:document.links.length,buttons:document.querySelectorAll('button,input[type=button],input[type=submit]').length,images:document.images.length}));
      return {ok:true,engine:'Electron BrowserWindow',page,steps:results,console:logs.slice(-200),failures,artifacts};
    }finally{
      this.activeBrowsers.delete(jobId); try{if(!win.isDestroyed())win.destroy();}catch(_){}
    }
  }

  securityScan(payload={},hooks={}){
    this.assertEnabled(); if(this.config.security.enabled!==true)throw new Error('Security scanner desactivado.');
    const root=this.assertRoot(payload.root); const files=this.walk(root,{extensions:TEXT_EXTENSIONS,maxFiles:Math.min(MAX_SCAN_FILES,Number(payload.maxFiles)||6000)}); const findings=[];
    const rules=[
      {id:'secret-openai',severity:'high',re:/\bsk-[A-Za-z0-9_-]{20,}/g,label:'Posible API key hardcoded'},
      {id:'secret-github',severity:'high',re:/\bgh[pousr]_[A-Za-z0-9]{20,}/g,label:'Posible GitHub token hardcoded'},
      {id:'private-key',severity:'critical',re:/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,label:'Private key incluida en código'},
      {id:'js-eval',severity:'medium',re:/\beval\s*\(/g,label:'Uso de eval()'},
      {id:'js-innerhtml',severity:'low',re:/\.innerHTML\s*=/g,label:'Asignación innerHTML; revisar XSS'},
      {id:'php-shell',severity:'high',re:/\b(?:shell_exec|passthru|system|proc_open|popen)\s*\(/gi,label:'Ejecución de comandos desde PHP'},
      {id:'php-sql-concat',severity:'medium',re:/\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^;\n]{0,200}\.(?:\s*)\$_(?:GET|POST|REQUEST)/gi,label:'Posible SQL construido con input'},
      {id:'insecure-http',severity:'low',re:/http:\/\/(?!127\.0\.0\.1|localhost)/gi,label:'Endpoint HTTP sin TLS'},
    ];
    let scanned=0;
    for(const file of files){if(hooks.isCancelled?.())throw new Error('Security scan cancelado.');let stat;try{stat=fs.statSync(file);}catch(_){continue;}if(stat.size>MAX_TEXT_FILE)continue;let text;try{text=fs.readFileSync(file,'utf8');}catch(_){continue;}for(const rule of rules){rule.re.lastIndex=0;let m;while((m=rule.re.exec(text))!==null){const raw=m[0];const masked=/secret|private-key/.test(rule.id)?raw.slice(0,6)+'…REDACTED…':truncateMiddle(raw.replace(/\s+/g,' '),260);findings.push({rule:rule.id,severity:rule.severity,label:rule.label,path:relativePosix(root,file),line:lineNumberAt(text,m.index),snippet:masked});if(findings.length>=1000)break;}if(findings.length>=1000)break;}scanned++;if(scanned%100===0)hooks.progress?.({phase:'security',label:`Security scan: ${scanned}/${files.length}`});if(findings.length>=1000)break;}
    const order={critical:4,high:3,medium:2,low:1};findings.sort((a,b)=>order[b.severity]-order[a.severity]||a.path.localeCompare(b.path));
    return {ok:true,root,scannedFiles:scanned,findings,counts:findings.reduce((o,f)=>(o[f.severity]=(o[f.severity]||0)+1,o),{})};
  }

  dbInspect(payload={}){
    this.assertEnabled(); if(this.config.database.inspectEnabled!==true)throw new Error('Database Inspector desactivado.');
    const file=this.assertAllowed(payload.path,{mustExist:true}); const ext=extOf(file);
    if(ext==='.sql'){
      const text=fs.readFileSync(file,'utf8');const tables=[];let m;const re=/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"\[]?([A-Za-z_][\w]*)/gi;while((m=re.exec(text))!==null)tables.push(m[1]);return {ok:true,type:'sql-schema',path:file,tables:[...new Set(tables)]};
    }
    if(!['.sqlite','.sqlite3','.db'].includes(ext))throw new Error('db.inspect soporta SQLite (.sqlite/.sqlite3/.db) o archivos .sql.');
    let DatabaseSync;try{({DatabaseSync}=require('node:sqlite'));}catch(e){throw new Error('node:sqlite no disponible en este runtime: '+e.message);}
    const db=new DatabaseSync(file,{open:true,readOnly:true});
    try{
      const rows=db.prepare("SELECT name,type,sql FROM sqlite_master WHERE type IN ('table','view','index') ORDER BY type,name").all(); const tables=[];
      for(const r of rows.filter(x=>x.type==='table'&&!String(x.name).startsWith('sqlite_'))){const cols=db.prepare(`PRAGMA table_info(${JSON.stringify(r.name)})`).all();const indexes=db.prepare(`PRAGMA index_list(${JSON.stringify(r.name)})`).all();tables.push({name:r.name,columns:cols.map(c=>({name:c.name,type:c.type,notnull:Boolean(c.notnull),pk:Boolean(c.pk),default:c.dflt_value})),indexes:indexes.map(i=>({name:i.name,unique:Boolean(i.unique)}))});}
      return {ok:true,type:'sqlite',path:file,tables,views:rows.filter(x=>x.type==='view').map(x=>x.name),indexCount:rows.filter(x=>x.type==='index').length};
    }finally{try{db.close();}catch(_){}}
  }

  dbMigrate(payload={}){
    this.assertEnabled(); if(this.config.database.migrationsEnabled!==true)throw new Error('Database migrations están desactivadas. Habilítelas explícitamente en developer.json.');
    if(payload.confirm!=='APPLY_DATABASE_MIGRATION')throw new Error('Se requiere confirm="APPLY_DATABASE_MIGRATION".');
    const file=this.assertAllowed(payload.path,{mustExist:true}); const sql=String(payload.sql||'').trim(); if(!sql)throw new Error('Migration SQL vacía.');
    let DatabaseSync;try{({DatabaseSync}=require('node:sqlite'));}catch(e){throw new Error('node:sqlite no disponible: '+e.message);}
    const backup=path.join(this.backupsDir,`${safeId(path.basename(file))}-${Date.now()}.bak`);fs.copyFileSync(file,backup);
    const db=new DatabaseSync(file);try{db.exec('BEGIN IMMEDIATE;');db.exec(sql);db.exec('COMMIT;');}catch(e){try{db.exec('ROLLBACK;');}catch(_){}throw new Error(`Migration falló; backup preservado en ${backup}: ${e.message}`);}finally{try{db.close();}catch(_){}}
    return {ok:true,path:file,backup};
  }

  async gitRun(payload={},hooks={}){
    this.assertEnabled(); if(this.config.git.enabled!==true)throw new Error('Git Developer desactivado.');
    const operation=String(payload.operation||'status'); const allowedOps=new Set(['status','diff','log','branch','show','rev-parse','add','commit']);
    if(!allowedOps.has(operation)){
      if(['pull','push','fetch'].includes(operation)&&this.config.git.networkEnabled===true){}else throw new Error(`Operación Git no permitida: ${operation}`);
    }
    const argsMap={
      'status':['status','--short','--branch'],
      'diff':['diff','--',...(Array.isArray(payload.paths)?payload.paths:[])],
      'log':['log','--oneline','-n',String(Math.max(1,Math.min(100,Number(payload.limit)||20)))],
      'branch':['branch','--show-current'],
      'show':['show','--stat','--oneline',String(payload.ref||'HEAD')],
      'rev-parse':['rev-parse',String(payload.ref||'HEAD')],
      'add':['add','--',...(Array.isArray(payload.paths)&&payload.paths.length?payload.paths:['.'])],
      'commit':['commit','-m',String(payload.message||'Nexa Developer update')],
      'pull':['pull','--ff-only'], 'push':['push'], 'fetch':['fetch','--all','--prune']
    };
    const cwd=this.assertAllowed(payload.root,{mustExist:true}); if(!fs.statSync(cwd).isDirectory())throw new Error('Git root no es directorio.');
    return this.runControlledProcess({cwd,command:'git',args:argsMap[operation],timeoutMs:payload.timeoutMs,jobId:hooks.jobId},hooks);
  }

  stateFile(id){ return path.join(this.jobsDir,safeId(id)+'.json'); }
  loadJob(id){ const j=readJson(this.stateFile(id),null); if(!j)throw new Error(`Developer job no encontrado: ${id}`); return j; }
  saveJob(job){job.updatedAt=nowIso();writeJsonAtomic(this.stateFile(job.id),sanitizeForStorage(job));return job;}

  async executeTool(type,payload={},hooks={}){
    switch(type){
      case'developer.capabilities':return this.capabilities();
      case'developer.config':return this.updateConfig(payload);
      case'developer.file.list':return this.fileList(payload);
      case'developer.file.read':return this.fileRead(payload);
      case'developer.file.write':return this.fileWrite(payload);
      case'developer.file.replace':return this.fileReplace(payload);
      case'developer.file.mkdir':return this.fileMkdir(payload);
      case'developer.file.delete':return this.fileDelete(payload);
      case'developer.semantic.index':return this.semanticIndex(payload,hooks);
      case'developer.semantic.search':return this.semanticSearch(payload);
      case'developer.terminal.run':return this.runTerminal(payload,hooks);
      case'developer.browser.run':return this.browserRun(payload,hooks);
      case'developer.security.scan':return this.securityScan(payload,hooks);
      case'developer.db.inspect':return this.dbInspect(payload);
      case'developer.db.migrate':return this.dbMigrate(payload);
      case'developer.git.run':return this.gitRun(payload,hooks);
      default:throw new Error(`Developer tool no soportada: ${type}`);
    }
  }

  async workflowRun(payload={},hooks={},resumeJob=null){
    this.assertEnabled(); const id=safeId(resumeJob?.id||payload.id||payload.jobId||hooks.jobId||crypto.randomUUID()); const root=payload.root||resumeJob?.root; if(root)this.assertRoot(root);
    const steps=resumeJob?.steps||((Array.isArray(payload.steps)?payload.steps:[]).map((s,i)=>({id:safeId(s.id||`step-${i+1}`),type:String(s.type||''),payload:s.payload||{},status:'pending',attempts:0,result:null,error:'',startedAt:null,finishedAt:null})));
    if(!steps.length)throw new Error('developer.workflow.run requiere steps.');
    let job=resumeJob||{id,version:VERSION,root:root||'',title:String(payload.title||'Developer workflow').slice(0,180),status:'running',createdAt:nowIso(),updatedAt:nowIso(),currentStep:0,steps,metadata:payload.metadata||{}};
    job.status='running'; this.cancelledJobs.delete(id); this.saveJob(job);
    for(let i=0;i<job.steps.length;i++){
      const step=job.steps[i]; if(step.status==='done')continue; if(this.cancelledJobs.has(id)||hooks.isCancelled?.()){job.status='cancelled';this.saveJob(job);throw new Error('Developer workflow cancelado.');}
      job.currentStep=i;step.status='running';step.attempts=(step.attempts||0)+1;step.startedAt=nowIso();step.error='';this.saveJob(job);hooks.progress?.({phase:'workflow-step',label:`${i+1}/${job.steps.length} · ${step.type}`,step:i+1,total:job.steps.length,workflowId:id});
      try{
        const merged={root:job.root,...(step.payload||{}),jobId:id}; step.result=await this.executeTool(step.type,merged,{...hooks,jobId:id});
        if(step.result&&step.result.ok===false&&step.payload?.allowFailure!==true)throw new Error(step.result.error||step.result.stderr||`${step.type} devolvió ok=false`);
        step.status='done';step.finishedAt=nowIso();this.saveJob(job);
      }catch(e){step.status='error';step.error=e.message||String(e);step.finishedAt=nowIso();job.status='error';job.error=step.error;this.saveJob(job);throw e;}
    }
    job.status='done';job.currentStep=job.steps.length;job.finishedAt=nowIso();this.saveJob(job);return {ok:true,workflowId:id,status:'done',steps:job.steps.map(s=>({id:s.id,type:s.type,status:s.status,attempts:s.attempts,result:s.result,error:s.error}))};
  }

  jobList(payload={}){
    const limit=Math.max(1,Math.min(200,Number(payload.limit)||50));
    const items=[];
    for(const name of fs.readdirSync(this.jobsDir).filter(n=>n.endsWith('.json'))){const job=readJson(path.join(this.jobsDir,name),null);if(job)items.push({id:job.id,title:job.title||'',status:job.status||'',currentStep:job.currentStep||0,totalSteps:Array.isArray(job.steps)?job.steps.length:0,createdAt:job.createdAt||'',updatedAt:job.updatedAt||'',finishedAt:job.finishedAt||null,error:job.error||''});}
    items.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return {ok:true,jobs:items.slice(0,limit)};
  }
  jobStatus(payload={}){const job=this.loadJob(payload.id||payload.jobId);return {ok:true,job};}
  async jobResume(payload={},hooks={}){const job=this.loadJob(payload.id||payload.jobId);if(job.status==='done')return {ok:true,workflowId:job.id,status:'done',alreadyDone:true,steps:job.steps};if(job.status==='cancelled'&&payload.force!==true)throw new Error('Job cancelado. Use force=true para reanudar.');
    if(JSON.stringify(job.steps||[]).includes('[REDACTED_SECRET]'))throw new Error('Este job contenía datos sensibles que no se guardaron en disco. Reenvíe la tarea con esas credenciales para continuar de forma segura.');for(const s of job.steps){if(s.status==='running')s.status='pending';if(s.status==='error'&&payload.retryFailed!==false)s.status='pending';}job.status='running';job.error='';return this.workflowRun({},hooks,job);}
  jobCancel(payload={}){const id=safeId(payload.id||payload.jobId);this.cancelledJobs.add(id);const proc=this.activeProcesses.get(id);if(proc){try{proc.kill();}catch(_){}}const win=this.activeBrowsers.get(id);if(win){try{if(!win.isDestroyed())win.destroy();}catch(_){}}let job=readJson(this.stateFile(id),null);if(job){job.status='cancelled';job.cancelledAt=nowIso();this.saveJob(job);}return {ok:true,jobId:id,cancelled:true};}

  async execute(type,payload={},hooks={}){
    this.assertEnabled();
    if(type==='developer.workflow.run')return this.workflowRun(payload,hooks);
    if(type==='developer.job.list')return this.jobList(payload);
    if(type==='developer.job.status')return this.jobStatus(payload);
    if(type==='developer.job.resume')return this.jobResume(payload,hooks);
    if(type==='developer.job.cancel')return this.jobCancel(payload);
    return this.executeTool(type,payload,hooks);
  }
}

module.exports={DeveloperRuntime,VERSION,defaultConfig,TEXT_EXTENSIONS,INDEX_EXTENSIONS};
