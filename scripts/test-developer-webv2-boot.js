'use strict';
const{test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const main=fs.readFileSync(path.join(__dirname,'..','main-v203.js'),'utf8');
async function run(config){
 const records=[],listeners=new Map(),app={whenReady:()=>Promise.resolve(),on:(event,fn)=>listeners.set(event,fn)};
 class FakeHostedWebAgent{
   constructor(opts){this.opts=opts;this.started=false;this.stopped=false;records.push(this)}
   start(){this.started=true;return Promise.resolve()}
   stop(){this.stopped=true}
 }
 const fake={
   electron:{ipcMain:{handle(){return true}},BrowserWindow:class{},app},
   './lib/hosted-web-agent-v203':{HostedWebAgent:FakeHostedWebAgent,loadConfig:()=>config},
   './lib/hosted-web-fastchat-v204':{installWebIntelligenceFastPath(){},wrapCapturedChatHandler(){}},
   './lib/developer-autonomous-v281':{install(){}},
   './lib/developer-webv2-bridge':{install(){}},
   './main-v198.js':{},
   path
 };
 vm.runInNewContext(main,{require:(name)=>{if(!Object.prototype.hasOwnProperty.call(fake,name))throw Error('Unexpected require '+name);return fake[name]},setTimeout:fn=>fn(),console,path},{filename:'main-v203.js'});
 await Promise.resolve();await Promise.resolve();
 return {records,listeners};
}
test('Conserva original y abre segundo Worker solo con endpoint HTTPS y token válido',async()=>{
 const {records,listeners}=await run({serverUrl:'https://original.example/nexa',agentToken:'x'.repeat(24),developerWebServerUrl:'https://clon.example/developer-host',developerWebAgentToken:'y'.repeat(24)});
 assert.equal(records.length,2);assert.equal(records[0].opts.config,undefined);
 assert.equal(records[1].opts.config.serverUrl,'https://clon.example/developer-host');
 assert.equal(records[1].opts.config.agentToken,'y'.repeat(24));
 assert.equal(records[0].started,true);assert.equal(records[1].started,true);
 listeners.get('before-quit')();assert.equal(records[0].stopped,true);assert.equal(records[1].stopped,true);
});
test('Conector original sin segundo URL queda igual, sin cambiar Chat ni imágenes',async()=>{
 const a=await run({serverUrl:'https://original.example/nexa',agentToken:'x'.repeat(24)});assert.equal(a.records.length,1);assert.equal(a.records[0].started,true);
 const b=await run({serverUrl:'https://original.example/nexa',agentToken:'x'.repeat(24),developerWebServerUrl:'https://original.example/nexa',developerWebAgentToken:'y'.repeat(24)});assert.equal(b.records.length,1);
 const c=await run({serverUrl:'https://original.example/nexa',agentToken:'x'.repeat(24),developerWebServerUrl:'http://insecure.example/nexa',developerWebAgentToken:'y'.repeat(24)});assert.equal(c.records.length,1);
});
