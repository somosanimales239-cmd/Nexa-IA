'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const a=require('../lib/developer-autonomous-v281');
function context(){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'nexa281-recovery-'));
  const source=path.join(home,'RentaDeAutos');
  const baseDir=path.join(home,'Runtime');
  fs.mkdirSync(source,{recursive:true});fs.mkdirSync(baseDir,{recursive:true});
  fs.writeFileSync(path.join(source,'README.md'),'# Renta de autos\n');
  const developer={baseDir,config:{enabled:true},assertRoot:p=>{if(p!==source)throw Error('Root blocked');return source;}};
  return {home,source,developer};
}
function fake(actions){const q=actions.slice();let calls=0;return{get calls(){return calls},model:async()=>{calls++;return JSON.stringify(q.shift()||{action:'finish',needsMoreWork:true,summary:'no completado'})}};}
async function run(c,task,actions,maxSteps=9){const f=fake(actions);const out=await a.runAgent({developer:c.developer,payload:{root:c.source,task,maxSteps},jobId:'regression_'+crypto.randomBytes(5).toString('hex'),ollama:f.model});return{out,calls:f.calls};}
const marker='PRUEBA NEXA 270 OK';
test('Qwen read+append completa linea exacta sin exigir finish y preserva origen',async()=>{
 const c=context();try{
 const {out,calls}=await run(c,'Abre README.md y agrega al final la línea exacta '+marker,[{action:'read',path:'README.md'},{action:'append',path:'README.md',content:marker+'\n'}, {action:'append',path:'README.md',content:marker+'\n'}, {action:'append',path:'README.md',content:marker+'\n'}]);
 assert.equal(out.status,'review_required');assert.equal(calls,4);
 assert.equal(out.files.length,1);assert.equal(out.files[0].path,'README.md');assert(out.zip?.size>0);
 assert.equal(fs.readFileSync(path.join(c.source,'README.md'),'utf8'),'# Renta de autos\n');
 assert.equal(fs.readFileSync(path.join(out.workspace,'README.md'),'utf8'),'# Renta de autos\n'+marker+'\n');
 assert.equal(out.qa.level,'text_only_review');
 assert.equal(out.finished,false);
 }finally{fs.rmSync(c.home,{recursive:true,force:true})}
});
test('Qwen insiste con append ya aplicado en tarea multiarchivo: resultado incompleto, no bloqueado, ZIP existente',async()=>{
 const c=context();try{
 const {out}=await run(c,'Agrega una línea al final de README.md y luego inspecciona otros archivos del proyecto',[
  {action:'read',path:'README.md'},
  {action:'append',path:'README.md',content:'MARCADOR\n'},
  {action:'append',path:'README.md',content:'MARCADOR\n'},
  {action:'append',path:'README.md',content:'MARCADOR\n'},
  {action:'append',path:'README.md',content:'MARCADOR\n'}
 ]);
 assert.equal(out.status,'incomplete');assert.equal(out.ok,false);
 assert.equal(out.invalidActions.length,0);assert(out.zip?.size>0);
 assert.equal(fs.readFileSync(path.join(out.workspace,'README.md'),'utf8'),'# Renta de autos\nMARCADOR\n');
 assert.equal(fs.readFileSync(path.join(c.source,'README.md'),'utf8'),'# Renta de autos\n');
 const report=a.readReport(c.developer,{jobId:out.jobId});
 assert.equal(report.status,'incomplete');assert.equal(report.zip.size,out.zip.size);
 }finally{fs.rmSync(c.home,{recursive:true,force:true})}
});
test('Prueba multiarchivo no se certifica por haber agregado un marcador',async()=>{
 const c=context();try{
 const {out}=await run(c,'Añade al final de README.md el marcador ABC123 y después modifica clientes.php',[
 {action:'read',path:'README.md'},
 {action:'append',path:'README.md',content:'ABC123\n'},
 {action:'finish',needsMoreWork:true,summary:'Falta clientes.php'}]);
 assert.equal(out.status,'incomplete');assert.equal(out.ok,false);assert.equal(out.finished,false);
 assert(out.zip?.size>0);
 }finally{fs.rmSync(c.home,{recursive:true,force:true})}
});
test('Archivo ya tenía contenido pedido: no declara éxito falso ni modifica original',async()=>{
 const c=context();try{
 fs.appendFileSync(path.join(c.source,'README.md'),marker+'\n');
 const {out}=await run(c,'Abre README.md y agrega al final la línea exacta '+marker,[
 {action:'read',path:'README.md'},
 {action:'append',path:'README.md',content:marker+'\n'},
 {action:'finish',summary:'ya aplicado'}]);
 assert.equal(out.status,'incomplete');assert.equal(out.files.length,0);assert.equal(out.zip,null);
 }finally{fs.rmSync(c.home,{recursive:true,force:true})}
});
test('Solicitud insegura fuera de workspace sigue bloqueada',async()=>{
 const c=context();try{
 const {out}=await run(c,'Escribe archivo fuera del proyecto para probar seguridad',[
 {action:'write',path:'../outside.js',content:'bad'},
 {action:'finish',needsMoreWork:true}]);
 assert.equal(out.status,'incomplete');assert.equal(out.files.length,0);
 assert.equal(out.invalidActions.length,1);
 assert(!fs.existsSync(path.join(c.home,'outside.js')));
 }finally{fs.rmSync(c.home,{recursive:true,force:true})}
});
