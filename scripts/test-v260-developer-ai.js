'use strict';
const http=require('http');
const os=require('os');
const fs=require('fs');
const path=require('path');
const assert=require('assert');
const {DeveloperRuntime}=require('../lib/developer-runtime-v260');
(async()=>{
  const server=http.createServer((req,res)=>{
    if(req.url==='/api/tags'){
      res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({models:[{name:'qwen2.5-coder:7b'}]}));
    }
    if(req.url==='/api/chat'&&req.method==='POST'){
      let data='';req.on('data',c=>data+=c);req.on('end',()=>{
        const body=JSON.parse(data||'{}');
        assert.strictEqual(body.model,'qwen2.5-coder:7b');
        assert.ok(Array.isArray(body.messages)&&body.messages.length>=1);
        res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({model:body.model,message:{role:'assistant',content:'PATCH_OK'},done:true,prompt_eval_count:42,eval_count:8}));
      });return;
    }
    res.writeHead(404);res.end('{}');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const port=server.address().port;
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'nexa-v260-'));
  const rt=new DeveloperRuntime({baseDir:base,config:{ai:{baseUrl:`http://127.0.0.1:${port}`,model:'qwen2.5-coder:7b'}}});
  try{
    const status=await rt.execute('developer.ai.status',{});
    assert.strictEqual(status.available,true);
    const result=await rt.execute('developer.ai.generate',{messages:[{role:'system',content:'You code.'},{role:'user',content:'Return patch.'}]},{jobId:'test-ai'});
    assert.strictEqual(result.ok,true);assert.strictEqual(result.model,'qwen2.5-coder:7b');assert.strictEqual(result.content,'PATCH_OK');
    console.log('Nexa AI v2.6.0 Developer AI test: OK');
  }finally{server.close();fs.rmSync(base,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
