'use strict';
const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {DeveloperRuntime}=require('../lib/developer-runtime-v250');

(async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'nexa-v250-'));
  const project=path.join(temp,'project');fs.mkdirSync(project,{recursive:true});
  const runtime=new DeveloperRuntime({baseDir:path.join(temp,'runtime'),config:{
    enabled:true,allowedRoots:[project],terminal:{enabled:true,allowedCommands:['node'],timeoutMs:30000,maxOutput:100000},
    browser:{enabled:false},git:{enabled:false,networkEnabled:false},database:{inspectEnabled:true,migrationsEnabled:false},security:{enabled:true}
  }});

  const fakeToken='ghp_'+'A'.repeat(32);
  fs.mkdirSync(path.join(project,'scripts'),{recursive:true});

  fs.writeFileSync(path.join(project,'.env'),'API_KEY=super-secret-value\n');
  let sensitiveBlocked=false;try{runtime.fileRead({root:project,path:'.env',allowUnknownText:true});}catch(_){sensitiveBlocked=true;}assert.equal(sensitiveBlocked,true);
  const write=runtime.fileWrite({root:project,path:'src/app.js',content:"function hello(name){ return 'hi '+name; }\nconst token='"+fakeToken+"';\nmodule.exports={hello};\n"});
  assert.equal(write.ok,true);assert.equal(write.created,true);
  const read=runtime.fileRead({root:project,path:'src/app.js'});assert(read.content.includes('function hello'));
  const rep=runtime.fileReplace({root:project,path:'src/app.js',find:"return 'hi '+name;",replace:"return 'hello '+name;"});assert.equal(rep.replacements,1);

  const idx=runtime.semanticIndex({root:project});assert.equal(idx.ok,true);assert(idx.symbolCount>=1);
  const search=runtime.semanticSearch({root:project,query:'hello'});assert.equal(search.ok,true);assert(search.results.some(x=>x.path==='src/app.js'));

  const security=runtime.securityScan({root:project});assert.equal(security.ok,true);assert(security.findings.some(x=>x.rule==='secret-github'));

  fs.writeFileSync(path.join(project,'scripts','terminal-test.js'),'console.log(\"NEXA_DEV_OK\");\n',{encoding:'utf8'});
  const term=await runtime.runTerminal({cwd:project,command:'node',args:['scripts/terminal-test.js'],timeoutMs:20000},{jobId:'terminal-test'});
  assert.equal(term.exitCode,0);assert(term.stdout.includes('NEXA_DEV_OK'));
  let inlineBlocked=false;try{await runtime.runTerminal({cwd:project,command:'node',args:['-e','console.log(1)']},{jobId:'inline-test'});}catch(_){inlineBlocked=true;}assert.equal(inlineBlocked,true);

  const wf=await runtime.workflowRun({id:'workflow-test',root:project,steps:[
    {id:'read',type:'developer.file.read',payload:{path:'src/app.js'}},
    {id:'terminal',type:'developer.terminal.run',payload:{command:'node',args:['scripts/terminal-test.js'],timeoutMs:20000}}
  ]},{jobId:'workflow-test'});
  assert.equal(wf.status,'done');assert.equal(runtime.jobStatus({id:'workflow-test'}).job.status,'done');
  const again=await runtime.jobResume({id:'workflow-test'});assert.equal(again.alreadyDone,true);

  try{
    const {DatabaseSync}=require('node:sqlite');const dbFile=path.join(project,'test.sqlite');const db=new DatabaseSync(dbFile);db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT);');db.close();
    const dbInfo=runtime.dbInspect({path:dbFile});assert.equal(dbInfo.ok,true);assert(dbInfo.tables.some(t=>t.name==='users'));
  }catch(e){if(!/node:sqlite/.test(String(e&&e.message)))throw e;}

  let blocked=false;try{runtime.fileRead({root:project,path:path.join('..','outside.txt')});}catch(_){blocked=true;}assert.equal(blocked,true);
  try{const outside=path.join(temp,'outside');fs.mkdirSync(outside,{recursive:true});fs.writeFileSync(path.join(outside,'secret.txt'),'nope');fs.symlinkSync(outside,path.join(project,'escape'),'dir');let symlinkBlocked=false;try{runtime.fileRead({root:project,path:'escape/secret.txt'});}catch(_){symlinkBlocked=true;}assert.equal(symlinkBlocked,true);}catch(e){if(process.platform!=='win32')throw e;}
  runtime.saveJob({id:'secret-job',status:'running',steps:[{id:'login',type:'developer.browser.run',status:'pending',payload:{sensitive:true,text:'MyPassword123'}}]});
  const stored=fs.readFileSync(runtime.stateFile('secret-job'),'utf8');assert(!stored.includes('MyPassword123'));assert(stored.includes('[REDACTED_SECRET]'));
  fs.rmSync(temp,{recursive:true,force:true});
  console.log('Nexa AI v2.5.0 Developer Runtime tests: OK');
})().catch(err=>{console.error(err);process.exit(1);});
