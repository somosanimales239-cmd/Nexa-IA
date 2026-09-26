'use strict';
const fs=require('fs');const path=require('path');
const root=path.join(__dirname,'..');
const required=['main-v187.js','main-v185.js','main.js','preload.js','src/index.html','src/reference-panel-v187.js','lib/visual-review-v185.js','lib/visual-review-v187.js','package.json'];
for(const f of required){const p=path.join(root,f);if(!fs.existsSync(p)){console.error('Missing:',f);process.exit(1);}}
const main=fs.readFileSync(path.join(root,'main-v187.js'),'utf8');
if(!main.includes('BrowserWindow')||!main.includes('loadFile(')||!main.includes("require('./main-v185')")){console.error('v1.8.7 active Electron graph invalid');process.exit(2);}
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(pkg.version!=='1.8.7'||pkg.main!=='main-v187.js'){console.error('package.json does not select v1.8.7');process.exit(3);}
const vr=fs.readFileSync(path.join(root,'lib','visual-review-v187.js'),'utf8');
if(!vr.includes('uncertain_is_failure:false')||!vr.includes('const THRESHOLD = 78')){console.error('soft review rules missing');process.exit(4);}
console.log('Nexa AI v1.8.7 validation: OK');
