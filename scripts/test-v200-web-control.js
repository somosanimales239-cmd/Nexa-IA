'use strict';
const assert=require('assert');
const http=require('http');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {
  NexaWebControlServer,encodeAttachmentToken,splitPromptSections,chooseImagePlan,chooseUpscaler,chooseHiresUpscaler
}=require('../lib/nexa-web-control-v200');

assert(splitPromptSections('a realistic city. Negative Prompt: anime, blurry').positive.includes('realistic city'));
assert.equal(splitPromptSections('a realistic city. Negative Prompt: anime, blurry').negative,'anime, blurry');
const fourK=chooseImagePlan({preset:'4k-landscape',steps:30,cfg:5.5});
assert.deepEqual([fourK.width,fourK.height,fourK.targetWidth,fourK.targetHeight],[1024,576,3840,2160]);
const vertical=chooseImagePlan({preset:'4k-portrait'});
assert.deepEqual([vertical.width,vertical.height,vertical.targetWidth,vertical.targetHeight],[576,1024,2160,3840]);
assert.equal(chooseUpscaler([{name:'None'},{name:'R-ESRGAN 4x+'}],''),'R-ESRGAN 4x+');
assert.equal(chooseHiresUpscaler([{name:'Latent'},{name:'Latent (bicubic antialiased)'}],''),'Latent (bicubic antialiased)');
const marker=encodeAttachmentToken('abc123');
assert(marker.startsWith('\u2063\u2063')&&marker.endsWith('\u2064\u2064')&&marker.length>20);

const onePixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z3H0AAAAASUVORK5CYII=';
const forge=http.createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/sdapi/v1/options')return res.end(JSON.stringify({sd_model_checkpoint:'RealVisXL.safetensors'}));
  if(req.url==='/sdapi/v1/sd-models')return res.end(JSON.stringify([{title:'RealVisXL.safetensors'}]));
  if(req.url==='/sdapi/v1/samplers')return res.end(JSON.stringify([{name:'DPM++ 2M'}]));
  if(req.url==='/sdapi/v1/schedulers')return res.end(JSON.stringify([{label:'Karras'}]));
  if(req.url==='/sdapi/v1/upscalers')return res.end(JSON.stringify([{name:'R-ESRGAN 4x+'}]));
  if(req.url==='/sdapi/v1/latent-upscale-modes')return res.end(JSON.stringify([{name:'Latent (bicubic antialiased)'}]));
  if(req.url==='/sdapi/v1/progress?skip_current_image=true')return res.end(JSON.stringify({progress:.5,eta_relative:10}));
  if(req.url==='/sdapi/v1/txt2img')return res.end(JSON.stringify({images:[onePixel],info:'{}'}));
  if(req.url==='/sdapi/v1/extra-single-image')return res.end(JSON.stringify({image:onePixel,html_info:''}));
  if(req.url==='/sdapi/v1/interrupt')return res.end('{}');
  res.statusCode=404;res.end('{}');
});

forge.listen(0,'127.0.0.1',async()=>{
  const forgePort=forge.address().port;
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'nexa-web-v200-'));
  const fakeApp={getPath:()=>tmp};
  const handlers=new Map([
    ['store:get',async()=>({appVersion:'2.0.0',settings:{},chats:[],memories:[]})],
    ['knowledge:list',async()=>({libraries:[]})],
    ['knowledge-db:objectives',async()=>[]],
    ['knowledge-db:stats',async()=>({})],
    ['engine:status',async()=>({online:true})],
    ['system:stats',async()=>({ram:1})],
    ['factory:list',async()=>[]],
    ['chat-attachments:stage',async(_event,payload)=>({ok:true,token:'abc123',files:(payload.files||[]).map(x=>({name:x.name}))})],
    ['store:chat:save',async(_event,chat)=>chat],
    ['chat:start',async(event,payload)=>{event.sender.send('chat:token',{requestId:payload.requestId,content:'hola desde Nexa'});event.sender.send('chat:done',{requestId:payload.requestId,stats:{test:true}});return {ok:true};}],
    ['chat:stop',async()=>true],
  ]);
  const root=path.join(tmp,'root');fs.mkdirSync(path.join(root,'webapp'),{recursive:true});
  for(const file of ['index.html','app.js','app.css'])fs.copyFileSync(path.join(__dirname,'..','webapp',file),path.join(root,'webapp',file));
  const server=new NexaWebControlServer({app:fakeApp,handlers,rootDir:root,host:'127.0.0.1',port:0,version:'2.0.0'});
  server.saveConfig({forgeBaseUrl:`http://127.0.0.1:${forgePort}`,autoOpen:false,minimizeDesktop:false});
  await server.start();
  try{
    const base=server.status().url.replace(/\/$/,'');
    const session=await fetch(base+'/api/session').then(r=>r.json());assert(session.ok&&session.token);
    const headers={'X-Nexa-Web-Token':session.token,'Content-Type':'application/json'};
    const boot=await fetch(base+'/api/bootstrap',{headers}).then(r=>r.json());assert(boot.ok&&boot.forge.ok);
    const generated=await fetch(base+'/api/forge/generate',{method:'POST',headers,body:JSON.stringify({prompt:'realistic city',preset:'4k-landscape',model:'RealVisXL.safetensors',upscaler:'R-ESRGAN 4x+',hiresFix:false})}).then(r=>r.json());
    assert(generated.ok&&generated.width===3840&&generated.height===2160&&generated.fileName);
    assert(fs.existsSync(path.join(server.generatedDir,generated.fileName)));
    const staged=await fetch(base+'/api/attachments/stage',{method:'POST',headers,body:JSON.stringify({files:[{name:'note.txt',type:'text/plain',data:'aG9sYQ=='}]})}).then(r=>r.json());
    assert(staged.ok&&staged.token==='abc123');
    const chatResponse=await fetch(base+'/api/chat/stream',{method:'POST',headers,body:JSON.stringify({requestId:'req_test',attachmentToken:'abc123',payload:{messages:[{role:'user',content:'hola'}]}})});
    const chatText=await chatResponse.text();
    assert(chatText.includes('event: chat.token')&&chatText.includes('hola desde Nexa')&&chatText.includes('event: chat.done'));
    console.log('Nexa AI v2.0.0 Web Control + Forge tests: OK');
  } finally {
    await server.stop();forge.close();fs.rmSync(tmp,{recursive:true,force:true});
  }
});
