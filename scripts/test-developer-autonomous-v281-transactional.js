'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const a=require('../lib/developer-autonomous-v281');
const PHRASE='Sistema de clientes administrado por Nexa AI';
const ORIGINAL=`<?php
require __DIR__ . '/app/bootstrap.php'; require_login();
page_header('Clientes'); ?>
<div class="panel"><h2>Nuevo cliente</h2></div>
<?php page_footer();
`;
const TASK=`En clientes.php agrega debajo del título principal un pequeño texto azul que diga '${PHRASE}'. Conserva todas las funciones existentes y verifica sintaxis PHP.`;
function setup(){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'nexa-qa-transactional-'));
  const source=path.join(home,'RentaDeAutos'),baseDir=path.join(home,'runtime');
  fs.mkdirSync(source,{recursive:true});fs.mkdirSync(baseDir,{recursive:true});
  fs.writeFileSync(path.join(source,'clientes.php'),ORIGINAL);
  fs.writeFileSync(path.join(source,'README.md'),'# Prueba segura\n');
  const developer={baseDir,config:{enabled:true},assertRoot:p=>{assert.equal(p,source);return p;}};
  return {home,source,developer};
}
async function replay(ctx,steps,task=TASK){
  const list=steps.slice();let calls=0;
  const result=await a.runAgent({developer:ctx.developer,payload:{root:ctx.source,task,maxSteps:Math.min(36,steps.length+2)},jobId:'qa_'+crypto.randomBytes(7).toString('hex'),ollama:async()=>{calls++;return JSON.stringify(list.shift()||{action:'finish',needsMoreWork:true,summary:'faltan pasos'});}});
  return {result,calls};
}
const read={action:'read',path:'clientes.php'};
const invalid=(html=`<div style="color: blue;">${PHRASE}</div>\n`)=>({action:'append',path:'clientes.php',content:html});
const anchor="page_header('Clientes'); ?>";
const correct={action:'replace',path:'clientes.php',find:anchor,replace:`${anchor}\n<div style="color: blue;">${PHRASE}</div>`};
const finish={action:'finish',summary:'Cambio PHP correcto verificado',needsMoreWork:false};
const beforeCheck=(ctx,result)=>{
 assert.equal(fs.readFileSync(path.join(ctx.source,'clientes.php'),'utf8'),ORIGINAL,'Proyecto original fue modificado');
 assert(!result.files.some(x=>x.path.includes('..')),'Escape de workspace');
};
const stop=ctx=>fs.rmSync(ctx.home,{recursive:true,force:true});

test('Se rechaza inmediatamente HTML fuera de <?php y se revierte antes de aceptar otra acción',async()=>{
 const ctx=setup();try{
  const {result}=await replay(ctx,[read,invalid(),finish]);
  beforeCheck(ctx,result);
  assert.equal(result.files.length,0);
  assert(result.invalidActions.some(x=>/PHP_BOUNDARY|LINT_REAL/.test(x.error)),JSON.stringify(result.invalidActions));
  assert.equal(result.zip,null);
 }finally{stop(ctx)}
});

test('Qwen puede recuperarse de PHP inválido, usar replace correcto y terminar con un solo mensaje',async()=>{
 const ctx=setup();try{
  const {result}=await replay(ctx,[read,invalid(),read,correct,finish]);
  beforeCheck(ctx,result);
  assert.equal(result.status,'review_required',JSON.stringify({status:result.status,actions:result.invalidActions,qa:result.qa}));
  const content=fs.readFileSync(path.join(result.workspace,'clientes.php'),'utf8');
  assert.equal(content.split(PHRASE).length-1,1);
  assert(content.indexOf(PHRASE)>content.indexOf('page_header('));
  assert(content.indexOf(PHRASE)<content.indexOf('page_footer('));
  assert.equal(result.qa.level,'syntax_checked');
  assert(result.zip?.size>0);
  assert.equal(result.files.length,1);
 }finally{stop(ctx)}
});

test('Seis intentos de repetir la misma etiqueta con HTML distinto no generan siete copias',async()=>{
 const ctx=setup();try{
  const variants=Array.from({length:7},(_,i)=>invalid(`<div data-n="${i}">${PHRASE}</div>\n`));
  const {result}=await replay(ctx,[read,correct,...variants,finish]);
  beforeCheck(ctx,result);
  const content=fs.readFileSync(path.join(result.workspace,'clientes.php'),'utf8');
  assert.equal(content.split(PHRASE).length-1,1,'Qwen produjo etiquetas repetidas');
  assert(result.invalidActions.length>=6);
  assert.equal(result.status,'blocked');
  assert(!result.qa || !result.qa.regressionVerified);
 }finally{stop(ctx)}
});

test('Se rechaza HTML duplicado aun si la sintaxis PHP pasa',async()=>{
 const ctx=setup();try{
  const duplicate={action:'replace',path:'clientes.php',find:'<div class="panel"><h2>Nuevo cliente</h2></div>',replace:`<div class="panel"><h2>Nuevo cliente</h2><span>${PHRASE}</span></div>`};
  const {result}=await replay(ctx,[read,correct,duplicate,finish]);
  beforeCheck(ctx,result);
  assert(result.invalidActions.some(x=>/TEXTO_DUPLICADO/.test(x.error)));
  const content=fs.readFileSync(path.join(result.workspace,'clientes.php'),'utf8');
  assert.equal(content.split(PHRASE).length-1,1);
  assert.equal(result.status,'review_required');
 }finally{stop(ctx)}
});

test('Sin PHP CLI no se certifica ningún candidato PHP aunque pase comprobación heurística',async()=>{
 const ctx=setup();const save=process.env.PATH;try{
   process.env.PATH='/no-such-directory-php-cli';
   const {result}=await replay(ctx,[read,correct,finish]);
   beforeCheck(ctx,result);
   assert.equal(result.status,'incomplete');
   assert(result.qa.syntax.find(x=>x.path==='clientes.php')?.skipped);
   assert.equal(result.qa.level,'not_verified');
   assert(result.zip?.size>0,'Debe conservar cambios solamente para revisión');
 }finally{process.env.PATH=save;stop(ctx)}
});

test('Control general JS sigue admitiendo cambios reales y solo usa Qwen Coder',async()=>{
 const ctx=setup();try{
   fs.writeFileSync(path.join(ctx.source,'hello.js'),'const x=1;\n');
   const {result}=await replay(ctx,[{action:'read',path:'hello.js'},{action:'replace',path:'hello.js',find:'const x=1;',replace:'const x=2;'},{action:'finish',summary:'JS modificado'}],'Cambia hello.js de x=1 a x=2, sin tocar otros archivos');
   assert.equal(result.status,'review_required');
   assert.equal(result.model,'qwen2.5-coder:7b');
   assert.equal(result.files.length,1);
   assert.equal(fs.readFileSync(path.join(ctx.source,'hello.js'),'utf8'),'const x=1;\n');
 }finally{stop(ctx)}
});
