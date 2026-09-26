'use strict';
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const required=['main-v188.js','package.json','nexa.project.json','lib/visual-review-v188.js','lib/visual-review-v185.js','src/reference-panel-v188.js','README-V1.8.8.md'];
for(const f of required){const full=path.join(root,f);if(!fs.existsSync(full))throw new Error('Missing '+f);const s=fs.readFileSync(full,'utf8');if(s.includes('<<<<<<<')||s.includes('>>>>>>>'))throw new Error('Conflict marker '+f);}
const main=fs.readFileSync(path.join(root,'main-v188.js'),'utf8');
for(const token of ["BrowserWindow","loadFile(path.join(__dirname, 'src', 'index.html'))","require('./main.js')","compilePremiumBrief","analyzeReferences","referenceAnchor","reference-panel-v188.js"])if(!main.includes(token))throw new Error('main-v188 missing '+token);
const lib=fs.readFileSync(path.join(root,'lib','visual-review-v188.js'),'utf8');
for(const token of ['PREMIUM POSITIVE PROMPT','PREMIUM NEGATIVE PROMPT','E019','reference_match','uncertain_is_failure:false'])if(!lib.includes(token))throw new Error('visual-review-v188 missing '+token);
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));if(pkg.version!=='1.8.8'||pkg.main!=='main-v188.js')throw new Error('package entry/version wrong');
console.log('Nexa AI v1.8.8 validation: OK');
