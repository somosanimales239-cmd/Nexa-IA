'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'..','main-v203.js'),'utf8');
function boot(cfg){
  const records=[],stops=[],handlers=new Map(),listeners={},workerLog=[];
  const app={whenReady:()=>Promise.resolve(),on:(name,cb)=>{listeners[name]=cb}};
  class MockAgent{
    constructor(opts){records.push({kind:'agent',opts});}
    start(){records.push({kind:'agent-start'});return Promise.resolve()}
    stop(){stops.push('agent')}
  }
  class MockWorker{
    constructor(opts){records.push({kind:'aider',opts})}
    start(){records.push({kind:'aider-start'})}
    stop(){stops.push('aider')}
  }
  const fake={
    electron:{ipcMain:{handle(){}},BrowserWindow:class{},app},
    './lib/hosted-web-agent-v203':{HostedWebAgent:MockAgent,loadConfig:()=>cfg,configPath:()=>'/tmp/nexa/agent.json'},
    './lib/hosted-web-fastchat-v204':{installWebIntelligenceFastPath(){},wrapCapturedChatHandler(){}},
    './lib/developer-autonomous-v281':{install(){}},
    './lib/developer-webv2-bridge':{install(){}},
    './lib/nexa-aider-worker':{AiderWorker:MockWorker},
    './main-v198.js':{},path
  };
  vm.runInNewContext(code,{require:name=>{if(!(name in fake))throw Error('Unknown require '+name);return fake[name]},console:{error(){},log(){}},setTimeout:fn=>fn(),path},{filename:'main-v203.js'});
  return {records,stops,listeners};
}
test('Existing Chat/Image Hosted Web Agent remains, and independent Aider worker starts once',async()=>{
 const {records,stops,listeners}=boot({serverUrl:'https://original.example/site',agentToken:'x'.repeat(32)});
 await Promise.resolve();await Promise.resolve();await Promise.resolve();
 assert.equal(records.filter(r=>r.kind==='agent').length,1);
 assert.equal(records.filter(r=>r.kind==='aider').length,1);
 assert.equal(records.filter(r=>r.kind==='agent-start').length,1);
 assert.equal(records.filter(r=>r.kind==='aider-start').length,1);
 assert.equal(records.find(r=>r.kind==='aider').opts.allowedRoots[0],'D:\\Projects');
 listeners['before-quit']();assert(stops.includes('agent'));assert(stops.includes('aider'));
});
test('Optional second Hosted Web Agent remains unchanged with Aider alongside',async()=>{
 const {records}=boot({serverUrl:'https://original.example/site',agentToken:'x'.repeat(32),developerWebServerUrl:'https://copy.example/site',developerWebAgentToken:'z'.repeat(32)});
 await Promise.resolve();await Promise.resolve();await Promise.resolve();
 assert.equal(records.filter(r=>r.kind==='agent').length,2);
 assert.equal(records.filter(r=>r.kind==='aider').length,1);
});
