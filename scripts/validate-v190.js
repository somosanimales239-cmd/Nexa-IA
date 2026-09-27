'use strict';
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const required=['main-v190.js','main-v189.js','main-v188.js','main.js','preload.js','src/index.html','src/app.js','src/chat-attachments-v190.js','lib/chat-routing-v190.js','lib/premium-prompt-compiler-v189.js','lib/visual-review-v188.js'];
for(const file of required)if(!fs.existsSync(path.join(root,file)))throw new Error('Missing v1.9.0 dependency: '+file);
const main=fs.readFileSync(path.join(root,'main-v190.js'),'utf8');
for(const token of ["require('./main-v189.js')",'chat-attachments:stage','qwen2.5vl:3b',"channel === 'chat:start'","channel === 'image:generate'","channel === 'store:chat:save'",'chat_attachment','referenceConfigFromRecord','loadFile('])if(!main.includes(token))throw new Error('main-v190 missing '+token);
const renderer=fs.readFileSync(path.join(root,'src','chat-attachments-v190.js'),'utf8');for(const token of ['nexaAttachBtn','dragenter','paste','stageAndSend','naturalReferenceGeneration','MutationObserver','chat_attachment'])if(!renderer.includes(token))throw new Error('renderer integration missing '+token);
function reqs(file){const src=fs.readFileSync(path.join(root,file),'utf8');return[...src.matchAll(/require\(['"]\.\/(main-v\d+\.js)['"]\)/g)].map(m=>m[1]);}
function chain(start,target,seen=new Set()){if(start===target)return true;if(seen.has(start)||!fs.existsSync(path.join(root,start)))return false;seen.add(start);return reqs(start).some(next=>chain(next,target,seen));}
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));const entry=String(pkg.main||'');if(!entry||!chain(entry,'main-v190.js'))throw new Error('Current entry does not transitively chain to main-v190.js: '+entry);
console.log(`Nexa AI v1.9.0 chat/vision layer validation: OK (active entry: ${entry})`);
