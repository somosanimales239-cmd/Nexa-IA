'use strict';
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const must=(v,m)=>{if(!v)throw new Error(m);};
for(const rel of ['lib/developer-runtime-v260.js','lib/hosted-web-agent-v203.js','package.json','nexa.project.json']){
  const full=path.join(root,rel);must(fs.existsSync(full),'Missing v2.6.0 file: '+rel);
  const src=fs.readFileSync(full,'utf8');must(!src.includes('<<<<<<<')&&!src.includes('>>>>>>>'),'Conflict marker: '+rel);
}
const runtime=read('lib/developer-runtime-v260.js');
for(const token of [
  "const VERSION = '2.6.0'",
  "model:'qwen2.5-coder:7b'",
  "case'developer.ai.status'",
  "case'developer.ai.generate'",
  'async aiGenerate(payload={},hooks={})',
  "'api/chat'",
  'Dedicated Nexa Developer coder brain'
]) must(runtime.includes(token),'Runtime v2.6.0 token missing: '+token);
const agent=read('lib/hosted-web-agent-v203.js');
must(agent.includes("require('./developer-runtime-v260')"),'Hosted agent must load developer-runtime-v260');
must(agent.includes("const VERSION = '2.6.0'"),'Hosted agent version must be 2.6.0');
const pkg=JSON.parse(read('package.json'));
must(pkg.version==='2.6.0','package version must be 2.6.0');
must(pkg.main==='main-v203.js','main entry must remain main-v203.js');
for(const k of ['validate:v260','test:v260','validate:v251','test:v251','validate:v250','test:v250'])must(Boolean(pkg.scripts&&pkg.scripts[k]),'Missing script '+k);
const project=JSON.parse(read('nexa.project.json'));
must(String(project.application_version)==='2.6.0','nexa.project application_version mismatch');
must(project.features.includes('developer-qwen2.5-coder-7b'),'Missing qwen coder project feature');
console.log('Nexa AI v2.6.0 Dedicated Developer Coder validation: OK');
