'use strict';
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const required=['main-v194.js','main-v193.js','lib/prompt-drift-guard-v194.js','lib/premium-prompt-compiler-v189.js','scripts/test-v194-prompt-drift-guard.js','package.json','nexa.project.json'];
for(const file of required){const full=path.join(root,file);if(!fs.existsSync(full))throw new Error('Missing v1.9.4 dependency: '+file);const source=fs.readFileSync(full,'utf8');if(source.includes('<<<<<<<')||source.includes('>>>>>>>'))throw new Error('Conflict marker: '+file);}
const main=fs.readFileSync(path.join(root,'main-v194.js'),'utf8');
for(const token of ["require('./main-v193.js')",'PromptDriftGuard.install(PremiumCompiler)',"channel === 'store:get'","loadFile(path.join(__dirname, 'src', 'index.html'))","preload: path.join(__dirname, 'preload.js')"])if(!main.includes(token))throw new Error('main-v194 missing '+token);
const guard=fs.readFileSync(path.join(root,'lib','prompt-drift-guard-v194.js'),'utf8');
for(const token of ['constraint fusion','positiveReinforcement','negativeReinforcement','hardRequirements','action/pose must remain','environment/background','rendering/style','__nexaPromptDriftGuardV194'])if(!guard.includes(token))throw new Error('Prompt Drift Guard missing '+token);
function reqs(file){if(!fs.existsSync(path.join(root,file)))return[];const src=fs.readFileSync(path.join(root,file),'utf8');return[...src.matchAll(/require\(['"]\.\/(main-v\d+\.js)['"]\)/g)].map(m=>m[1]);}
function chain(start,target,seen=new Set()){if(start===target)return true;if(!start||seen.has(start)||!fs.existsSync(path.join(root,start)))return false;seen.add(start);return reqs(start).some(next=>chain(next,target,seen));}
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(pkg.version!=='1.9.4'||pkg.main!=='main-v194.js')throw new Error(`v1.9.4 package entry/version wrong: ${pkg.version} / ${pkg.main}`);
if(!chain(pkg.main,'main-v193.js'))throw new Error('v1.9.4 does not chain to v1.9.3');
for(const script of ['validate:v194','test:v194','validate:v193','test:v193','validate:v192','test:v192'])if(!String(pkg.scripts?.[script]||'').trim())throw new Error('package scripts missing '+script);
if(!String(pkg.scripts.validate||'').includes('validate:v194')||!String(pkg.scripts.validate||'').includes('test:v194'))throw new Error('global validate does not include v1.9.4 checks');
const buildFiles=Array.isArray(pkg?.build?.files)?pkg.build.files.map(String):[];for(const file of ['main-v194.js','main-v193.js','main-v192.js','main-v191.js','main-v190.js','main-v189.js','main-v188.js','main.js','preload.js'])if(!buildFiles.includes(file))throw new Error('electron-builder missing '+file);
const project=JSON.parse(fs.readFileSync(path.join(root,'nexa.project.json'),'utf8'));if(String(project.application_version||project.version||'')!=='1.9.4'||String(project.build||'')!=='1.9.4')throw new Error('nexa.project version/build mismatch');
console.log('Nexa AI v1.9.4 Prompt Drift Guard validation: OK');
