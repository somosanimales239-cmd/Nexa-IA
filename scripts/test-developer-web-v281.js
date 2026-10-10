'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const js=fs.readFileSync(path.join(__dirname,'..','assets/developer-chat-bridge.js'),'utf8');
function harness({result,status}){
  const refs=new Map();
  const makeEl=()=>({style:{},dataset:{},children:[],appendChild(x){this.children.push(x)},addEventListener(k,f){this['on'+k]=f},click(){}});
  refs.set('chatDeveloperDock',makeEl());
  const calls=[];
  const context={console,URL,Uint8Array,Blob,Date,Promise,setTimeout,clearTimeout,crypto:globalThis.crypto,
    confirm:()=>true,window:{},document:{readyState:'complete',querySelector:()=>({content:'demo'}),getElementById:x=>refs.get(x)||null,createElement:()=>makeEl()},
    fetch:async(url,opts)=>{
      if(String(url).includes('api/web/command.php')){
        const body=JSON.parse(opts.body);calls.push(body.type);
        return {ok:true,json:async()=>({ok:true,jobId:body.type})};
      }
      const type=decodeURIComponent(String(url).split('id=')[1]||'');
      const value=type==='developer.capabilities'?{enabled:true,allowedRoots:['D:\\Projects']}:type==='developer.agent.status'?status:result;
      return {ok:true,json:async()=>({ok:true,job:{status:'done',result:value}})};
    }
  };
  vm.runInNewContext(js,context);
  return {bridge:context.window.NexaDeveloperChatBridge,calls,refs};
}
const status={agentLoaded:true,version:'2.8.1',buildId:'nexa-agent-281-reliability-20261010',model:'qwen2.5-coder:7b',ready:true};
test('Puente Web no declara completado cuando Windows reporta blocked',async()=>{
  const h=harness({status,result:{status:'blocked',version:'2.8.1',model:'qwen2.5-coder:7b',error:'Seis acciones invalidas',invalidActions:[{step:1,action:'read',path:'missing.php',error:'No existe'}],files:[],zip:null}});
  const r=await h.bridge.run({task:'Prueba de edición segura del README del proyecto',project:{local_root:'D:\\Projects\\RentaDeAutos'},onProgress:()=>{}});
  assert.equal(r.finished,false);assert.equal(r.failed,true);assert.equal(r.status,'blocked');assert(r.summary.includes('No existe'));assert(r.summary.includes('Bloqueado'));
  assert(h.calls.includes('developer.agent.run'));assert(!h.calls.includes('developer.agent.artifact'));
});
test('Version check bloquea una app Windows antigua antes de editar',async()=>{
  const h=harness({status:{...status,version:'2.8.0'},result:{status:'blocked'}});
  await assert.rejects(h.bridge.checkInstalled(),/Agente equivocado/);
});
test('Version check reconoce buildId exacto de agente v281',async()=>{
  const h=harness({status,result:{}});const r=await h.bridge.checkInstalled();assert.equal(r.buildId,status.buildId);
});
