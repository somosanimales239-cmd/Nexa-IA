'use strict';
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const required=['main-v189.js','main-v188.js','main.js','preload.js','src/index.html','lib/visual-review-v188.js','lib/premium-prompt-compiler-v189.js'];
for(const file of required)if(!fs.existsSync(path.join(root,file)))throw new Error('Missing v1.8.9 dependency: '+file);
const main189=fs.readFileSync(path.join(root,'main-v189.js'),'utf8');if(!main189.includes('BrowserWindow')||!main189.includes('loadFile(')||!main189.includes("require('./main-v188.js')"))throw new Error('main-v189 runtime graph invalid');
const compiler=fs.readFileSync(path.join(root,'lib','premium-prompt-compiler-v189.js'),'utf8');for(const token of ['PREMIUM POSITIVE PROMPT','PREMIUM NEGATIVE PROMPT','exactly ${x.count}','same main subject identity'])if(!compiler.includes(token))throw new Error('Premium compiler missing '+token);
function requiresOf(file){const src=fs.readFileSync(path.join(root,file),'utf8');return [...src.matchAll(/require\(['"]\.\/(main-v\d+\.js)['"]\)/g)].map(m=>m[1]);}
function chainsTo(start,target,seen=new Set()){if(start===target)return true;if(seen.has(start)||!fs.existsSync(path.join(root,start)))return false;seen.add(start);return requiresOf(start).some(next=>chainsTo(next,target,seen));}
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));const entry=String(pkg.main||'');if(!chainsTo(entry,'main-v189.js'))throw new Error('Current entry does not transitively chain to main-v189.js: '+entry);
console.log(`Nexa AI v1.8.9 layer validation: OK (active entry: ${entry})`);
