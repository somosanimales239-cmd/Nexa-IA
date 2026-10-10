'use strict';
const{test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const bridge=require('../lib/developer-webv2-bridge');
function fixture(){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'nexa-webv2-')),source=path.join(base,'RentaDeAutos'),runtime=path.join(base,'runtime');fs.mkdirSync(source);fs.mkdirSync(runtime);
 fs.mkdirSync(path.join(source,'pages'));fs.writeFileSync(path.join(source,'pages','clientes.js'),'const page = "original";\n');
 fs.writeFileSync(path.join(source,'pages','clientes.php'),'<?php\necho "ok";\n');
 fs.writeFileSync(path.join(source,'.env'),'PRIVATE_TOKEN=DO_NOT_COPY');fs.mkdirSync(path.join(source,'uploads'));fs.writeFileSync(path.join(source,'uploads','key.txt'),'PRIVATE');
 return{base,source,developer:{baseDir:runtime,config:{enabled:true},assertRoot(r){assert.equal(path.resolve(r),path.resolve(source));return source;},capabilities(){return{ok:true,version:'2.6.0',enabled:true,allowedRoots:[source],ai:{enabled:true,model:'qwen2.5-coder:7b'},tools:['developer.ai.generate','developer.terminal.run']}}}};
}
async function invoke(f,action,p={}){return bridge.execute(f.developer,'developer.webv2.'+action,p)}
function dispose(f){fs.rmSync(f.base,{recursive:true,force:true})}
async function initialized(){const f=fixture();const r=await invoke(f,'workspace.create',{sourceRoot:f.source,workspaceId:'qa_'+crypto.randomBytes(5).toString('hex')});return {f,id:r.workspaceId}}
test('Capacidades declaradas: web controla estrategia, Windows ejecuta solo Qwen Coder',()=>{const f=fixture();try{const caps=bridge.capabilities(f.developer);assert.equal(caps.model,'qwen2.5-coder:7b');assert.equal(caps.settingsFromWeb,true);assert(caps.executionTools.includes('browser'));assert(caps.workspaceTools.includes('package'));}finally{dispose(f)}});
test('El puente intercepta solo webv2 y bloquea modelos ajenos sin alterar Chat',async()=>{class Agent{constructor(){this.developer={baseDir:'/tmp',config:{enabled:true},capabilities(){return{enabled:true}}}}async runDeveloper(job){return{delegated:job.type}}};bridge.install(Agent);const a=new Agent();assert.equal((await a.runDeveloper({type:'chat.start'})).delegated,'chat.start');assert.equal((await a.runDeveloper({type:'developer.ai.generate',payload:{model:'qwen2.5-coder:7b'}})).delegated,'developer.ai.generate');await assert.rejects(a.runDeveloper({type:'developer.ai.generate',payload:{model:'gpt-oss:20b'}}),/exclusivamente/);assert.equal((await a.runDeveloper({type:'developer.webv2.capabilities'})).protocol,bridge.PROTOCOL);bridge.install(Agent)});
test('Copia aislada excluye .env y uploads y preserva los originales',async()=>{const {f,id}=await initialized();try{const p=path.join(f.developer.baseDir,'web-control-v3',id,'workspace');assert(!fs.existsSync(path.join(p,'.env')));assert(!fs.existsSync(path.join(p,'uploads')));assert.equal(fs.readFileSync(path.join(f.source,'pages/clientes.js'),'utf8'),'const page = "original";\n')}finally{dispose(f)}});
test('Lectura aporta SHA y modificación válida sólo afecta la copia',async()=>{const {f,id}=await initialized();try{const r=await invoke(f,'workspace.read',{workspaceId:id,path:'pages/clientes.js'});const out=await invoke(f,'workspace.edit',{workspaceId:id,path:r.path,action:'replace',expectedSha256:r.sha256,find:'"original"',replace:'"nuevo"'});assert.equal(out.qa.kind,'node-check');assert.equal(out.qa.ok,true);assert.equal(fs.readFileSync(path.join(f.source,r.path),'utf8'),'const page = "original";\n');assert((await invoke(f,'workspace.status',{workspaceId:id})).changed['pages/clientes.js'])}finally{dispose(f)}});
test('JavaScript roto se rechaza inmediatamente y revierte la operación',async()=>{const {f,id}=await initialized();try{const r=await invoke(f,'workspace.read',{workspaceId:id,path:'pages/clientes.js'});await assert.rejects(invoke(f,'workspace.edit',{workspaceId:id,path:r.path,action:'replace',expectedSha256:r.sha256,find:'"original"',replace:';'}),/QA_REJECTED/);assert.equal((await invoke(f,'workspace.read',{workspaceId:id,path:r.path})).sha256,r.sha256);assert.equal(Object.keys((await invoke(f,'workspace.status',{workspaceId:id})).changed).length,0)}finally{dispose(f)}});
test('Hash antiguo, ancla ambigua y rutas peligrosas se rechazan',async()=>{const {f,id}=await initialized();try{const p={workspaceId:id,path:'pages/clientes.js',action:'replace',expectedSha256:'bad',find:'original',replace:'other'};await assert.rejects(invoke(f,'workspace.edit',p),/PRECONDITION_SHA/);const r=await invoke(f,'workspace.read',p);await assert.rejects(invoke(f,'workspace.edit',{...p,expectedSha256:r.sha256,find:'const',replace:'const'}),/NO_CHANGE/);await assert.rejects(invoke(f,'workspace.read',{workspaceId:id,path:'../.env'}),/Ruta/);await assert.rejects(invoke(f,'workspace.read',{workspaceId:id,path:'uploads/key.txt'}),/Ruta/)}finally{dispose(f)}});
test('Reemplazo duplicado evita la segunda etiqueta aun con ancla distinta',async()=>{const {f,id}=await initialized();try{let r=await invoke(f,'workspace.read',{workspaceId:id,path:'pages/clientes.js'});const repl='const first = "Sistema de clientes administrado por Nexa AI";\n';await invoke(f,'workspace.edit',{workspaceId:id,path:r.path,action:'replace',expectedSha256:r.sha256,find:'const page = "original";',replace:repl+'const page = "original";'});r=await invoke(f,'workspace.read',{workspaceId:id,path:r.path});await assert.rejects(invoke(f,'workspace.edit',{workspaceId:id,path:r.path,action:'replace',expectedSha256:r.sha256,find:'const page = "original";',replace:repl+'const page = "original";'}),/DUPLICATE_GUARD/);}finally{dispose(f)}});
test('QA real y ZIP son únicamente cambios con fragmentos SHA verificables',async()=>{const {f,id}=await initialized();try{const r=await invoke(f,'workspace.read',{workspaceId:id,path:'pages/clientes.js'});await invoke(f,'workspace.edit',{workspaceId:id,path:r.path,action:'replace',expectedSha256:r.sha256,find:'"original"',replace:'"mejorado"'});const qa=await invoke(f,'workspace.qa',{workspaceId:id});assert.equal(qa.checks.length,1);assert.equal(qa.checks[0].ok,true);const p=await invoke(f,'workspace.package',{workspaceId:id});assert.equal(p.artifact.fileCount,1);assert.equal(p.status,'review_required');const part=await invoke(f,'workspace.artifact',{workspaceId:id,part:0});assert.equal(sha(Buffer.from(part.chunkBase64,'base64')),part.chunkSha256);assert.equal(part.sha256,p.artifact.sha256);assert(!Buffer.from(part.chunkBase64,'base64').includes(Buffer.from('PRIVATE_TOKEN')))}finally{dispose(f)}});
test('Sin cambios no fabrica ZIP ni reporta funcionalidad verificada',async()=>{const {f,id}=await initialized();try{const qa=await invoke(f,'workspace.qa',{workspaceId:id});assert.equal(qa.status,'no_changes');assert.equal(qa.functionalVerified,false);await assert.rejects(invoke(f,'workspace.package',{workspaceId:id}),/No se puede empaquetar/)}finally{dispose(f)}});
test('PHP roto se revierte cuando el linter está instalado',async()=>{const {f,id}=await initialized();try{const r=await invoke(f,'workspace.read',{workspaceId:id,path:'pages/clientes.php'});const checkBefore=await invoke(f,'workspace.qa',{workspaceId:id});assert.equal(checkBefore.status,'no_changes');let error=null;try{await invoke(f,'workspace.edit',{workspaceId:id,path:r.path,action:'replace',expectedSha256:r.sha256,find:'echo "ok";',replace:'echo ;'});}catch(e){error=e};if(error){assert.match(error.message,/QA_REJECTED/);assert.equal((await invoke(f,'workspace.read',{workspaceId:id,path:r.path})).sha256,r.sha256)}else{const result=await invoke(f,'workspace.qa',{workspaceId:id});assert.equal(result.checks[0].verified,false,'Sin PHP no se certifica sintaxis');}}finally{dispose(f)}});
test('No se crea ni se altera archivo fuera del laboratorio',async()=>{const {f,id}=await initialized();try{assert.throws(()=>bridge.safeRel('C:/Windows/system32/drivers/etc/hosts'));await assert.rejects(invoke(f,'workspace.edit',{workspaceId:id,path:'../../outside.js',action:'create',content:'x'}),/Ruta/);assert(!fs.existsSync(path.join(f.base,'outside.js')))}finally{dispose(f)}});
test('Laboratorio inexistente y estado deshabilitado se rechazan sin ocultar fallos',async()=>{const f=fixture();try{await assert.rejects(invoke(f,'workspace.status',{workspaceId:'missing123'}),/Laboratorio no creado/);f.developer.config.enabled=false;await assert.rejects(invoke(f,'capabilities'),/no disponible/)}finally{dispose(f)}});
function sha(v){return crypto.createHash('sha256').update(v).digest('hex')}
test('Integración real: v281 heredado delega Qwen a Web v2 sin cambiar otros motores',async()=>{
  const old=require('../lib/developer-autonomous-v281');
  const f=fixture();try{
    class Agent{constructor(){this.developer=f.developer}async runDeveloper(job){return{ok:true,type:job.type}}}
    old.install(Agent);bridge.install(Agent);
    const worker=new Agent();
    const caps=await worker.runDeveloper({type:'developer.capabilities',payload:{}});
    assert.equal(caps.webControlV3.protocol,bridge.PROTOCOL);
    assert.equal(caps.webControlV3.model,bridge.MODEL);
    const legacy=await worker.runDeveloper({type:'developer.ai.generate',payload:{model:bridge.MODEL}});
    assert.equal(legacy.type,'developer.ai.generate');
    const store=await worker.runDeveloper({type:'store.memory.save',payload:{}});
    assert.equal(store.type,'store.memory.save');
    const handshake=await worker.runDeveloper({type:'developer.webv2.capabilities',payload:{}});
    assert(handshake.executionTools.includes('sqlite.inspect'));
    assert.equal(handshake.toolDiagnostics.node.installed,true);
  }finally{dispose(f)}
});
test('Una nueva edición invalida el ZIP anterior: no se entrega artefacto obsoleto',async()=>{
 const {f,id}=await initialized();try{
  let r=await invoke(f,'workspace.read',{workspaceId:id,path:'pages/clientes.js'});
  await invoke(f,'workspace.edit',{workspaceId:id,path:r.path,action:'replace',expectedSha256:r.sha256,find:'"original"',replace:'"primero"'});
  await invoke(f,'workspace.package',{workspaceId:id});
  r=await invoke(f,'workspace.read',{workspaceId:id,path:r.path});
  await invoke(f,'workspace.edit',{workspaceId:id,path:r.path,action:'replace',expectedSha256:r.sha256,find:'"primero"',replace:'"segundo"'});
  await assert.rejects(invoke(f,'workspace.artifact',{workspaceId:id,part:0}),/No existe ZIP/);
  const packageAgain=await invoke(f,'workspace.package',{workspaceId:id});assert.equal(packageAgain.artifact.fileCount,1);
 }finally{dispose(f)}
});
