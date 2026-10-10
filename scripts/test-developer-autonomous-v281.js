'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const crypto=require('node:crypto');
const a=require('../lib/developer-autonomous-v281');
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'nexa-v281-test-'));
function init(){const root=temp(),project=path.join(root,'proyecto'),runtime=path.join(root,'runtime');fs.mkdirSync(project);fs.mkdirSync(runtime);fs.writeFileSync(path.join(project,'clientes.js'),'const greeting = "hola";\n');return{root,project,runtime,developer:{baseDir:runtime,config:{enabled:true},assertRoot(value){assert.equal(path.resolve(value),path.resolve(project));return project}}}}
async function mockRun(sequence,task='Implementa una modificación de prueba PHP'){
 const x=init(),out=await a.runAgent({developer:x.developer,payload:{root:x.project,task,maxSteps:12},jobId:'test_'+crypto.randomBytes(4).toString('hex'),ollama:async()=>JSON.stringify(sequence.shift()||{action:'finish',needsMoreWork:true,summary:'Sin terminar'})});return{x,out};
}
test('rutas seguras bloquean traversal, secretos y binarios',()=>{for(const x of ['../passwords.php','/etc/passwd','C:/test.php','abc\\evil.php','.env','data/app.sqlite','media.jpg','a/../b.php'])assert.throws(()=>a.relativeSafe(x));assert.equal(a.relativeSafe('app/bootstrap.php'),'app/bootstrap.php')});
test('JSON de acción aislado, sin aceptar instrucciones markdown',()=>{assert.equal(a.parseAction('Respuesta: ```json\n{"action":"read","path":"clientes.js"}\n```').action,'read');assert.throws(()=>a.parseAction('{"action":"run","cmd":"powershell"}'));assert.throws(()=>a.parseAction('{"action":"write","path":"../bad.php","content":"x"}'))});
test('copia privada excluye credenciales y preserva originales',()=>{const x=init();fs.mkdirSync(path.join(x.project,'data'));fs.writeFileSync(path.join(x.project,'data','app.sqlite'),'SECRET');fs.writeFileSync(path.join(x.project,'.env'),'HIDDEN');const copy=path.join(x.runtime,'stage');const before=a.makeSnapshot(x.project,copy);assert(before.has('clientes.js'));assert(!before.has('data/app.sqlite'));assert(!fs.existsSync(path.join(copy,'.env')));a.workspaceEdit(copy,{action:'replace',path:'clientes.js',find:'hola',replace:'nuevo'},new Set());assert.equal(fs.readFileSync(path.join(x.project,'clientes.js'),'utf8'),'const greeting = "hola";\n');assert.equal(a.resultChanged(copy,before).length,1)});
test('multiacción Qwen: read, replace y finish produce candidato Node check',async()=>{
 const {x,out}=await mockRun([{action:'read',path:'clientes.js'},{action:'replace',path:'clientes.js',find:'hola',replace:'nuevo'},{action:'finish',summary:'Cambiado'}]);
 assert.equal(fs.readFileSync(path.join(x.project,'clientes.js'),'utf8'),'const greeting = "hola";\n');
 assert.equal(out.files.length,1);assert.equal(out.files[0].path,'clientes.js');
 assert.equal(out.qa.testsExecuted,0);assert.equal(out.qa.regressionVerified,false);assert.equal(out.finished,false);
 assert(out.zip&&fs.existsSync(out.zip.path));assert.equal(out.zip.fileCount,1);
 assert(['review_required','incomplete'].includes(out.status));
});
test('errores de formato de Qwen interrumpen sin fabricar resultados',async()=>{const {out}=await mockRun([{action:'read',path:'clientes.js'}]);assert.equal(out.ok,false);assert.equal(out.status,'incomplete')});
test('repetición exacta de Qwen se detiene',async()=>{const x=init();let calls=0;const out=await a.runAgent({developer:x.developer,payload:{root:x.project,task:'Cambia la pantalla de clientes con cuidado',maxSteps:9},jobId:'loop',ollama:async()=>{calls++;return '{"action":"read","path":"clientes.js"}'}});assert.equal(out.status,'blocked');assert(calls<=4)});
test('bloqueo de cambios sobre archivos existentes usando write',()=>{const x=init();const stage=path.join(x.runtime,'stage');a.makeSnapshot(x.project,stage);assert.throws(()=>a.workspaceEdit(stage,{action:'write',path:'clientes.js',content:'bad'},new Set()),/NUEVO/)});
test('crea ZIP válido de sólo cambios, con CRC y nombres',()=>{const z=a.makeZip([{path:'a/clientes.js',data:Buffer.from('contenido')},{path:'asset.css',data:Buffer.from('body{}')}]);assert.equal(z.readUInt32LE(0),0x04034b50);assert(z.includes(Buffer.from('a/clientes.js')));assert.equal(z.readUInt32LE(z.length-22),0x06054b50)});
test('instalación intercepta solo developer.agent.* y delega los demás',async()=>{class Fake {async runDeveloper(j){return{delegated:j.type}}};a.install(Fake);const f=new Fake();assert.deepEqual(await f.runDeveloper({type:'developer.file.list'}),{delegated:'developer.file.list'});assert.equal((await f.runDeveloper({type:'developer.agent.status'})).model,'qwen2.5-coder:7b');a.install(Fake)});

test('artefacto por fragmentos con SHA verificado, sin filtrar archivos externos',async()=>{
 const {x,out}=await mockRun([{action:'read',path:'clientes.js'},{action:'replace',path:'clientes.js',find:'hola',replace:'nuevo'},{action:'finish',summary:'Hecho'}]);
 const one=a.readArtifact(x.developer,{jobId:out.jobId,part:0});
 assert.equal(one.parts,1);assert.equal(one.size,out.zip.size);
 assert.equal(crypto.createHash('sha256').update(Buffer.from(one.chunkBase64,'base64')).digest('hex'),one.chunkSha256);
 assert.throws(()=>a.readArtifact(x.developer,{jobId:'../secrets',part:9}));
});
test('lint detecta JS inválido y Qwen puede repararlo en máximo dos ciclos',async()=>{
 const {out}=await mockRun([
  {action:'replace',path:'clientes.js',find:'const greeting = "hola";',replace:'const greeting = ;'},
  {action:'finish',summary:'fallido'},
  {action:'replace',path:'clientes.js',find:'const greeting = ;',replace:'const greeting = "arreglado";'},
  {action:'finish',summary:'corregido'}
 ]);
 assert.equal(out.repairAttempts,1);assert.equal(out.qa.failed.length,0);assert.equal(out.status,'review_required');
});


test('v2.8.1 autenticidad de versión y diagnóstico con Ollama local simulado',async()=>{
 const http=require('node:http');
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({models:[{name:'qwen2.5-coder:7b'}]}))});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  class Fake {
    constructor(){this.developer={config:{ai:{baseUrl:'http://127.0.0.1:'+server.address().port}},capabilities:()=>({ok:true,enabled:true,version:'2.6.0',allowedRoots:[]})};this.active=null}
    async runDeveloper(j){return {delegated:j.type}}
    async runtimeStatus(){return {developer:{version:'2.6.0'},summary:'Developer ready'}}
    async dashboard(){return {developer:{version:'2.6.0'}}}
    async watchActive(){return 'old'}
  }
  a.install(Fake);const f=new Fake();
  const status=await f.runDeveloper({type:'developer.agent.status',payload:{}});
  assert.equal(status.version,'2.8.1');assert.equal(status.runtimeVersion,'2.6.0');
  assert.equal(status.ready,true);assert.equal(status.ollama.available,true);
  const caps=await f.runDeveloper({type:'developer.capabilities',payload:{}});
  assert.equal(caps.version,'2.8.1');assert.equal(caps.runtimeVersion,'2.6.0');assert.equal(caps.autonomous.loaded,true);
  assert.equal((await f.runtimeStatus()).developer.version,'2.8.1');
  assert.equal((await f.dashboard()).developer.version,'2.8.1');
  assert.deepEqual(await f.runDeveloper({type:'developer.file.read'}),{delegated:'developer.file.read'});
 }finally{await new Promise(resolve=>server.close(resolve))}
});
test('Watchdog mantiene tareas Developer vivas hasta 17 min, pero delega Chat intacto',async()=>{
 class Fake {
   constructor(){this.developer={capabilities:()=>({version:'2.6.0',enabled:true})};this.active=null;this.released=[]}
   async runDeveloper(j){return j}
   async watchActive(){return 'old-chat-watchdog'}
   async jobState(){return {status:'running'}}
   async releaseActive(a,reason){this.released.push(reason)}
 }
 a.install(Fake);const f=new Fake();
 f.active={id:'one',type:'chat.start',startedAt:Date.now()-4*60*1000};
 assert.equal(await f.watchActive(),'old-chat-watchdog');
 f.active={id:'two',type:'developer.agent.run',startedAt:Date.now()-4*60*1000};
 await f.watchActive();assert.deepEqual(f.released,[]);
 f.active.startedAt=Date.now()-18*60*1000;await f.watchActive();
 assert.deepEqual(f.released,['developer-17m-hard-timeout']);
});
test('ruta Windows reservada y rutas con doble punto son bloqueadas',()=>{
 for(const p of ['CON.php','x/NUL.txt','foo.php.','foo.php ','x/COM1.json','x/a:b.js','x/abc?.js'])assert.throws(()=>a.relativeSafe(p));
});
test('interrupción cancela llamada Qwen larga sin tocar la fuente',async()=>{
 const x=init(),job='abort_test_'+crypto.randomBytes(4).toString('hex');
 const run=a.runAgent({developer:x.developer,payload:{root:x.project,task:'Crea y corrige archivo clientes con varios pasos',maxSteps:6},jobId:job,
   ollama:({signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('Cancelado')),{once:true})})});
 await new Promise(resolve=>setTimeout(resolve,60));
 assert.equal(a.cancel(job).cancelled,true);
 const r=await run;assert.equal(r.status,'cancelled');
 assert.equal(fs.readFileSync(path.join(x.project,'clientes.js'),'utf8'),'const greeting = "hola";\n');
});

test('recorrido completo Web Agent -> Ollama simulado -> cambios aislados -> ZIP fragmentado',async()=>{
 const http=require('node:http');const x=init();
 const responses=[
   {action:'read',path:'clientes.js'},
   {action:'replace',path:'clientes.js',find:'hola',replace:'Hola Nexa 280'},
   {action:'finish',summary:'Prueba completada'}
 ];let calls=0;let detectedModel='';
 const server=http.createServer((req,res)=>{
   res.setHeader('Content-Type','application/json');
   if(req.url==='/api/tags')return res.end(JSON.stringify({models:[{name:'qwen2.5-coder:7b'}]}));
   if(req.url!=='/api/chat'){res.statusCode=404;return res.end('{}')}
   let b='';req.on('data',c=>b+=c);req.on('end',()=>{
     detectedModel=JSON.parse(b).model;
     const action=responses.shift()||{action:'finish',needsMoreWork:true};calls++;
     res.end(JSON.stringify({message:{content:JSON.stringify(action)}}));
   });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
   class Fake {
     constructor(){this.developer={...x.developer,config:{enabled:true,ai:{baseUrl:'http://127.0.0.1:'+server.address().port}},capabilities:()=>({version:'2.6.0',enabled:true})};this.active={id:'webagent-run',releasing:false};this.events=[]}
     async runDeveloper(j){throw Error('No debe delegarse una tarea agent.run')}
     async jobState(){return {status:'running'}}
     async postEvent(jobId,kind,payload){this.events.push({kind,payload})}
   }
   a.install(Fake);const f=new Fake();
   const result=await f.runDeveloper({type:'developer.agent.run',id:'webagent-run',payload:{root:x.project,task:'Actualiza el saludo de clientes en un archivo JS',baseUrl:'http://127.0.0.1:'+server.address().port,maxSteps:8}});
   assert.equal(detectedModel,'qwen2.5-coder:7b');assert.equal(calls,3);assert.equal(result.status,'review_required');
   assert.equal(result.files.length,1);assert.equal(fs.readFileSync(path.join(x.project,'clientes.js'),'utf8'),'const greeting = "hola";\n');
   const part=await f.runDeveloper({type:'developer.agent.artifact',payload:{jobId:'webagent-run',part:0}});
   const bytes=Buffer.from(part.chunkBase64,'base64');
   assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),result.zip.sha256);
   assert(f.events.some(e=>e.kind==='developer:progress'));
 }finally{await new Promise(resolve=>server.close(resolve))}
});

test('Qwen 7B aliases JSON: list/read_file/append_line/finish edit README only in private copy',async()=>{
 const x=init();fs.writeFileSync(path.join(x.project,'README.md'),'# Un proyecto\n');
 const seq=[
  {tool:'list_files'},
  {tool:'read_file',arguments:{file:'README.md'}},
  {operation:'append_line',file_path:'README.md',line:'PRUEBA NEXA 281 OK\n'},
  {action:'finish',summary:'Línea agregada'}
 ];
 const out=await a.runAgent({developer:x.developer,payload:{root:x.project,task:'Abre README.md y agrega al final la línea exacta PRUEBA NEXA 281 OK',maxSteps:8},jobId:'qwen_alias_'+crypto.randomBytes(4).toString('hex'),ollama:async()=>JSON.stringify(seq.shift()||{action:'finish',needsMoreWork:true})});
 assert.equal(out.status,'review_required');assert.equal(out.files.length,1);assert.equal(out.files[0].path,'README.md');
 assert.equal(fs.readFileSync(path.join(x.project,'README.md'),'utf8'),'# Un proyecto\n');
 assert.equal(fs.readFileSync(path.join(out.workspace,'README.md'),'utf8'),'# Un proyecto\nPRUEBA NEXA 281 OK\n');
 assert(out.zip&&fs.existsSync(out.zip.path));
 assert.equal(out.invalidActions.length,0);
 const report=a.readReport(x.developer,{jobId:out.jobId});assert.equal(report.status,'review_required');assert.equal(report.actionLog.length,4);
});

test('Los errores no se acumulan después de una acción exitosa y queda diagnóstico real',async()=>{
 const x=init();const seq=['esto no es json',
  '{"action":"read","path":"clientes.js"}',
  '{"action":"replace","path":"clientes.js","find":"HOLA QUE NO EXISTE","replace":"demo"}',
  '{"action":"replace","path":"clientes.js","find":"hola","replace":"nuevo"}',
  '{"action":"finish","summary":"cambiado"}'];
 const out=await a.runAgent({developer:x.developer,payload:{root:x.project,task:'Cambia saludo hola por nuevo',maxSteps:12},jobId:'recover_'+crypto.randomBytes(4).toString('hex'),ollama:async()=>seq.shift()||'{"action":"finish","needsMoreWork":true}'});
 assert.equal(out.status,'review_required');assert.equal(out.errors,2);assert.equal(out.invalidActions.length,2);assert(out.invalidActions[0].error);assert.equal(fs.readFileSync(path.join(x.project,'clientes.js'),'utf8'),'const greeting = "hola";\n');
});

test('Seis errores consecutivos bloquean y conservan todas las acciones rechazadas',async()=>{
 const x=init();const out=await a.runAgent({developer:x.developer,payload:{root:x.project,task:'Modifica pantalla de prueba sin escribir en original',maxSteps:12},jobId:'blocked_'+crypto.randomBytes(4).toString('hex'),ollama:(()=>{let n=0;return async()=>JSON.stringify({action:'read',path:'archivo-no-existe-'+(++n)+'.php'})})()});
 assert.equal(out.status,'blocked');assert.equal(out.errors,6);assert.equal(out.invalidActions.length,6);
 assert.equal(a.readReport(x.developer,{jobId:out.jobId}).invalidActions.length,6);
 assert.equal(out.files.length,0);assert.equal(out.finished,false);
});

test('No se puede escribir fuera de copia y append no duplica contenido existente',()=>{
 const x=init(),stage=path.join(x.runtime,'stage');a.makeSnapshot(x.project,stage);
 assert.throws(()=>a.workspaceEdit(stage,{action:'append',path:'../secret.js',content:'x'},new Set()));
 assert.throws(()=>a.workspaceEdit(stage,{action:'append',path:'clientes.js',content:'const greeting = "hola";\n'},new Set()),/ya está al final/);
 assert.equal(fs.readFileSync(path.join(x.project,'clientes.js'),'utf8'),'const greeting = "hola";\n');
});

test('Qwen puede devolver herramienta estructurada con argumentos anidados, sin permitir herramientas peligrosas',()=>{
  assert.deepEqual(a.parseAction(JSON.stringify({tool_calls:[{function:{name:'read_file',arguments:'{"path":"README.md"}'}}]})).action,'read');
  assert.equal(a.parseAction(JSON.stringify({tool:'append_file',input:{file:'README.md',text:'Demo\n'}})).content,'Demo\n');
  assert.throws(()=>a.parseAction(JSON.stringify({tool:'shell',args:{command:'rm -rf'}})),/no permitida/);
});

test('Si PHP no está instalado no envía a Qwen una falsa reparación de sintaxis',async()=>{
 const x=init();fs.writeFileSync(path.join(x.project,'clientes.php'),'<?php echo "Hola";\n');
 const old=process.env.PATH;process.env.PATH='';
 try{
  const check=await a.verifyChanges(x.project,['clientes.php']);
  assert.equal(check.failed.length,0);assert.equal(check.performed,0);assert(check.checks[0].skipped);
 }finally{process.env.PATH=old}
});

test('Archivos JSON inválidos se detectan realmente y archivos CSS entran solo a revisión',async()=>{
 const x=init();fs.writeFileSync(path.join(x.project,'settings.json'),'{"ok":true}');
 fs.writeFileSync(path.join(x.project,'style.css'),'body { color: blue; }\n');
 const checks=await a.verifyChanges(x.project,['settings.json','style.css']);
 assert.equal(checks.performed,1);assert.equal(checks.failed.length,0);
 fs.writeFileSync(path.join(x.project,'settings.json'),'{ broken json');
 const after=await a.verifyChanges(x.project,['settings.json']);
 assert.equal(after.failed.length,1);assert.equal(after.failed[0].check,'json-parse');
});
