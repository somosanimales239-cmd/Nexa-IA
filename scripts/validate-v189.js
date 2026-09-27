'use strict';
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const required=['main-v189.js','main-v188.js','main.js','preload.js','src/index.html','lib/visual-review-v188.js','lib/premium-prompt-compiler-v189.js'];
const missing=required.filter(x=>!fs.existsSync(path.join(root,x)));
if(missing.length){console.error('Missing v1.8.9 dependency:',missing.join(', '));process.exit(1);}
const entry=fs.readFileSync(path.join(root,'main-v189.js'),'utf8');
if(!entry.includes('BrowserWindow')||!entry.includes('loadFile(')){console.error('main-v189.js does not expose Electron BrowserWindow/loadFile graph for App Builder.');process.exit(2);}
if(!entry.includes("require('./main-v188.js')")){console.error('v1.8.9 is not chained to stable v1.8.8 runtime.');process.exit(3);}
const compiler=fs.readFileSync(path.join(root,'lib/premium-prompt-compiler-v189.js'),'utf8');
for(const token of ['PREMIUM POSITIVE PROMPT','PREMIUM NEGATIVE PROMPT','exactly ${x.count}','same main subject identity']){
  if(!compiler.includes(token)){console.error('Premium compiler missing expected rule:',token);process.exit(4);}
}
for(const file of ['main-v189.js','lib/premium-prompt-compiler-v189.js']){const t=fs.readFileSync(path.join(root,file),'utf8');if(t.includes('<<<<<<<')||t.includes('>>>>>>>')){console.error('Conflict marker:',file);process.exit(5);}}
console.log('Nexa AI v1.8.9 Invisible Premium Prompt Compiler validation: OK');
