'use strict';
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const required=['main-v188.js','package.json','nexa.project.json','lib/visual-review-v188.js','lib/visual-review-v185.js','src/reference-panel-v188.js','README-V1.8.8.md'];
for(const file of required){const full=path.join(root,file);if(!fs.existsSync(full))throw new Error('Missing '+file);const source=fs.readFileSync(full,'utf8');if(source.includes('<<<<<<<')||source.includes('>>>>>>>'))throw new Error('Conflict marker '+file);}
const main188=fs.readFileSync(path.join(root,'main-v188.js'),'utf8');
for(const token of ['BrowserWindow',"loadFile(path.join(__dirname, 'src', 'index.html'))","require('./main.js')",'compilePremiumBrief','analyzeReferences','referenceAnchor','reference-panel-v188.js'])if(!main188.includes(token))throw new Error('main-v188 missing '+token);
const visual188=fs.readFileSync(path.join(root,'lib','visual-review-v188.js'),'utf8');
for(const token of ['PREMIUM POSITIVE PROMPT','PREMIUM NEGATIVE PROMPT','E019','reference_match','uncertain_is_failure:false'])if(!visual188.includes(token))throw new Error('visual-review-v188 missing '+token);
function requiresOf(file){const src=fs.readFileSync(path.join(root,file),'utf8');return [...src.matchAll(/require\(['"]\.\/(main-v\d+\.js)['"]\)/g)].map(m=>m[1]);}
function chainsTo(start,target,seen=new Set()){if(start===target)return true;if(seen.has(start)||!fs.existsSync(path.join(root,start)))return false;seen.add(start);return requiresOf(start).some(next=>chainsTo(next,target,seen));}
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));const entry=String(pkg.main||'');if(!entry||!fs.existsSync(path.join(root,entry)))throw new Error('Current Electron main entry missing: '+entry);if(!chainsTo(entry,'main-v188.js'))throw new Error('Current Electron entry does not transitively chain to main-v188.js: '+entry);
console.log(`Nexa AI v1.8.8 base-runtime validation: OK (active entry: ${entry})`);
