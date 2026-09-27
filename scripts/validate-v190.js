'use strict';
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const required=['main-v190.js','main-v189.js','main-v188.js','main.js','preload.js','src/index.html','src/app.js','src/chat-attachments-v190.js','lib/chat-routing-v190.js','lib/premium-prompt-compiler-v189.js','lib/visual-review-v188.js'];
for(const file of required)if(!fs.existsSync(path.join(root,file)))throw new Error('Missing v1.9.0 dependency: '+file);
const main=fs.readFileSync(path.join(root,'main-v190.js'),'utf8');
for(const token of ["require('./main-v189.js')",'chat-attachments:stage','qwen2.5vl:3b',"channel === 'chat:start'","channel === 'image:generate'","channel === 'store:chat:save'",'chat_attachment','referenceConfigFromRecord','loadFile('])if(!main.includes(token))throw new Error('main-v190 missing '+token);
const preload=fs.readFileSync(path.join(root,'preload.js'),'utf8');for(const token of ['store: Object.freeze','engine: Object.freeze','chat: Object.freeze','attachments: Object.freeze','images: Object.freeze','knowledge: Object.freeze','factory: Object.freeze','bridge: Object.freeze','chat-attachments:stage'])if(!preload.includes(token))throw new Error('preload API missing '+token);
const renderer=fs.readFileSync(path.join(root,'src','chat-attachments-v190.js'),'utf8');
for(const token of ['nexaAttachBtn','dragenter','paste','stageAndSend','naturalReferenceGeneration','forceImageForNextSend','MutationObserver','chat_attachment','decoratePersistedAttachments'])if(!renderer.includes(token))throw new Error('renderer integration missing '+token);
const appJs=fs.readFileSync(path.join(root,'src','app.js'),'utf8');for(const token of ['id="promptInput"','id="sendBtn"']){ /* HTML ids validated below */ }
const html=fs.readFileSync(path.join(root,'src','index.html'),'utf8');if(!html.includes('id="promptInput"')||!html.includes('id="sendBtn"')||!html.includes('class="composer"'))throw new Error('Active chat composer contract changed');
if(!appJs.includes('function looksLikeImageRequest')||!appJs.includes('async function sendMessage'))throw new Error('Active renderer send contract changed');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));if(pkg.version!=='1.9.0'||pkg.main!=='main-v190.js')throw new Error(`v1.9.0 package entry/version wrong: ${pkg.version} / ${pkg.main}`);
const buildFiles=Array.isArray(pkg?.build?.files)?pkg.build.files.map(String):[];for(const file of ['main-v190.js','main-v189.js','main-v188.js','main.js','preload.js'])if(!buildFiles.includes(file))throw new Error('electron-builder missing '+file);
console.log('Nexa AI v1.9.0 integrated validation: OK');
