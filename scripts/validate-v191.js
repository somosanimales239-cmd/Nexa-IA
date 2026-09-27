'use strict';
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const required=[
  'main-v191.js','main-v190.js','main-v189.js','main-v188.js','main.js','preload.js',
  'src/index.html','src/app.js','src/web-intelligence-v191.js','src/chat-attachments-v190.js',
  'lib/web-intelligence-v191.js','lib/web-research.js','lib/browser-bridge.js',
  'package.json','nexa.project.json','scripts/test-v191-web-intelligence.js'
];
for(const file of required){
  const full=path.join(root,file);
  if(!fs.existsSync(full))throw new Error('Missing v1.9.1 dependency: '+file);
  const s=fs.readFileSync(full,'utf8');
  if(s.includes('<<<<<<<')||s.includes('>>>>>>>'))throw new Error('Conflict marker: '+file);
}
const main=fs.readFileSync(path.join(root,'main-v191.js'),'utf8');
for(const token of ["require('./main-v190.js')",'Premium Web Intelligence','web-intelligence:progress',"channel==='chat:start'",'researchForChat','injectResearch','loadFile('])if(!main.includes(token))throw new Error('main-v191 missing '+token);
const engine=fs.readFileSync(path.join(root,'lib','web-intelligence-v191.js'),'utf8');
for(const token of ['Premium Research Compiler','compileResearchPlan','targetedQueries','gatherIntelligentSources','verifyEvidence','Browser Bridge','searchProviders','sourceScore','CONFLICTING','INSUFFICIENT','local_confidence'])if(!engine.includes(token))throw new Error('web-intelligence-v191 missing '+token);
const preload=fs.readFileSync(path.join(root,'preload.js'),'utf8');
if(!preload.includes('webIntelligence: Object.freeze')||!preload.includes("on('web-intelligence:progress'"))throw new Error('preload missing Web Intelligence bridge');
const renderer=fs.readFileSync(path.join(root,'src','web-intelligence-v191.js'),'utf8');
for(const token of ['Web Intelligence v1.9.1','webIntelligence','generationBannerLabel','MutationObserver'])if(!renderer.includes(token))throw new Error('renderer Web Intelligence integration missing '+token);
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(pkg.version!=='1.9.1'||pkg.main!=='main-v191.js')throw new Error(`v1.9.1 package entry/version wrong: ${pkg.version} / ${pkg.main}`);
for(const script of ['validate:v191','test:v191','validate:v190','test:v190'])if(!String(pkg.scripts?.[script]||'').trim())throw new Error('package scripts missing '+script);
if(!String(pkg.scripts?.validate||'').includes('validate:v191')||!String(pkg.scripts?.validate||'').includes('test:v191'))throw new Error('global validate does not include v1.9.1 validation/tests');
const buildFiles=Array.isArray(pkg?.build?.files)?pkg.build.files.map(String):[];
for(const file of ['main-v191.js','main-v190.js','main-v189.js','main-v188.js','main.js','preload.js'])if(!buildFiles.includes(file))throw new Error('electron-builder missing '+file);
if(!buildFiles.some(x=>x==='src/**/*'||x.includes('src/')))throw new Error('electron-builder files do not include renderer sources');
if(!buildFiles.some(x=>x==='lib/**/*'||x.includes('lib/')))throw new Error('electron-builder files do not include Web Intelligence modules');
const project=JSON.parse(fs.readFileSync(path.join(root,'nexa.project.json'),'utf8'));
const projectVersion=String(project.application_version||project.version||'');
if(projectVersion!==pkg.version||String(project.build||'')!==pkg.version)throw new Error(`nexa.project version mismatch: ${projectVersion} / build ${project.build}`);
console.log('Nexa AI v1.9.1 Premium Web Intelligence validation: OK');
