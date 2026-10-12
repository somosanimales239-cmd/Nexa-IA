'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {AiderWorker,selectServer,PROTOCOL,validateRemoteRoot}=require('../lib/nexa-aider-worker');
const mk=()=>fs.mkdtempSync(path.join(os.tmpdir(),'nexa-aider-test-'));
function makeWorker(request,extra={}){
  const dir=mk();
  const config={enabled:true,serverUrl:'https://nexa.example/app',agentToken:'x'.repeat(32)};
  const w=new AiderWorker({loadConfig:()=>config,configDir:()=>dir,request,logger:{warn(){}},...extra});
  w.probe=async()=>({ok:true,version:'0.86.2',analysisOnly:true,rootBound:true});
  return {w,dir,config};
}
test('Only HTTPS authenticated configured worker; prefer explicit Developer Web endpoint',()=>{
  const token='z'.repeat(25);
  assert.equal(selectServer({enabled:true,serverUrl:'http://unsafe',agentToken:token}),null);
  assert.equal(selectServer({enabled:false,serverUrl:'https://safe',agentToken:token}),null);
  assert.equal(selectServer({enabled:true,serverUrl:'https://primary/path/',agentToken:token}).base,'https://primary/path');
  const s=selectServer({enabled:true,serverUrl:'https://primary',agentToken:token,developerWebServerUrl:'https://developer/clone',developerWebAgentToken:'q'.repeat(28)});
  assert.equal(s.base,'https://developer/clone');assert.equal(s.token,'q'.repeat(28));
});
test('Persistent worker ID is unique and stable, without storing credentials',()=>{
  const seen=[];const r=async(url,token,body)=>{seen.push(body);return{ok:true,job:null}};
  const {w,dir}=makeWorker(r);const w2=new AiderWorker({loadConfig:()=>({enabled:false}),configDir:()=>dir,request:r,logger:{warn(){}}});
  assert.match(w.id,/^[a-f0-9]{32}$/);assert.equal(w2.id,w.id);
  assert.equal(fs.readFileSync(path.join(dir,'aider-worker-id.txt'),'utf8'),w.id);
  fs.rmSync(dir,{recursive:true,force:true});
});
test('Dedicated hello/next calls; no shared Chat/Image URLs',async()=>{
  const records=[];
  const {w,dir}=makeWorker(async(url,token,body)=>{records.push({url,token,body});return {ok:true,job:null}});
  await w.cycle();
  assert.deepEqual(records.map(x=>x.body.action),['hello','next']);
  assert(records.every(x=>x.url==='https://nexa.example/app/developer/aider-worker.php'));
  assert(records.every(x=>!x.url.includes('/api/agent/next.php')));
  assert.equal(records[0].body.protocol,PROTOCOL);
  assert.equal(records[0].body.analysisOnly,true);
  assert.equal(records[0].body.rootBound,true);
  fs.rmSync(dir,{recursive:true,force:true});
});
test('Aider job success only if the response is structured and anchored to job',async()=>{
  const records=[];
  const job={id:'nda_'+crypto.randomBytes(16).toString('hex'),type:'developer.aider.analyze',payload:{protocol:PROTOCOL,root:'D:\\Projects\\Test',analysisOnly:true,allowEdits:false,includeSourceCode:false,maxFiles:300,maxSymbolsPerFile:120}};
  const {w,dir}=makeWorker(async(url,token,body)=>{records.push(body);return {ok:true,job:body.action==='next'?job:null}});
  w.handle=async() => ({ok:true,analysisOnly:true,protocol:PROTOCOL,root:job.payload.root,files:[]});
  await w.cycle();
  assert.deepEqual(records.map(x=>x.action),['hello','next','complete']);
  assert.equal(records[2].status,'done');assert.equal(records[2].jobId,job.id);
  fs.rmSync(dir,{recursive:true,force:true});
});
test('Worker marks errors and does not publish successful analysis after a failure',async()=>{
  const records=[];
  const job={id:'nda_'+crypto.randomBytes(16).toString('hex'),type:'developer.aider.analyze',payload:{}};
  const {w,dir}=makeWorker(async(url,token,body)=>{records.push(body);return {ok:true,job:body.action==='next'?job:null}});
  w.handle=async()=>{throw Error('Parser unavailable')};
  await assert.rejects(w.cycle(),/Parser unavailable/);
  assert.equal(records[2].status,'error');assert.equal(records[2].result,undefined);
  fs.rmSync(dir,{recursive:true,force:true});
});
test('Remote relative paths and arbitrary drives are blocked before any user script execution',()=>{
  for(const bad of ['..\\secret','D:\\Projects\\..\\Secrets','D:\\Projects\\ok\\..\\secret','C:\\Windows\\System32','D:/Projects/directory','D:\\Projects\\\u0000evil']){
    assert.throws(()=>validateRemoteRoot(bad),/Windows|Ruta|Traversal|permitido/);
  }
});
test('No Aider chat execution or model fallback is in the Worker or Python source',()=>{
  const script=fs.readFileSync(path.join(__dirname,'..','lib','nexa-aider-analyzer.py'),'utf8');
  const worker=fs.readFileSync(path.join(__dirname,'..','lib','nexa-aider-worker.js'),'utf8');
  assert(script.includes('from grep_ast.tsl import get_parser'));
  assert(!script.includes('aider.main'));
  assert(!worker.includes('gpt-oss:20b'));
  assert(!worker.includes('child_process.exec('));
  assert(!worker.includes('shell:true'));
  assert(worker.includes('shell:false'));
});
test('Bundled Python analyzer is materialized outside app.asar with integrity repair',()=>{
  const {w,dir}=makeWorker(async()=>({ok:true,job:null}));
  const script=w.ensureScript();
  assert.equal(path.basename(script),'nexa-aider-analyzer.py');
  assert(fs.existsSync(script));
  const source=fs.readFileSync(path.join(__dirname,'..','lib','nexa-aider-analyzer.py'));
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(script)).digest('hex'),crypto.createHash('sha256').update(source).digest('hex'));
  fs.writeFileSync(script,'malicious-candidate');
  w.ensureScript();
  assert.deepEqual(fs.readFileSync(script),source);
  fs.rmSync(dir,{recursive:true,force:true});
});
