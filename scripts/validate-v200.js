'use strict';
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const required=['main-v200.js','main-v198.js','lib/hosted-web-agent-v200.js','scripts/test-v200-hosted-web-agent.js','package.json','nexa.project.json'];
for(const file of required){const full=path.join(root,file);if(!fs.existsSync(full))throw new Error('Missing v2.0.0 dependency: '+file);const s=fs.readFileSync(full,'utf8');if(s.includes('<<<<<<<')||s.includes('>>>>>>>'))throw new Error('Conflict marker: '+file);}
const main=fs.readFileSync(path.join(root,'main-v200.js'),'utf8');
for(const token of ["require('./main-v198.js')",'HostedWebAgent',"loadFile(path.join(__dirname, 'src', 'index.html'))"])if(!main.includes(token))throw new Error('main-v200 missing '+token);
const agent=fs.readFileSync(path.join(root,'lib','hosted-web-agent-v200.js'),'utf8');
for(const token of ['api/agent/next.php','chat.start','forge.generate','sdapi/v1/txt2img','sdapi/v1/extra-single-image','chat-attachments:stage','X-Nexa-Agent-Token'])if(!agent.includes(token))throw new Error('Hosted agent missing '+token);
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
function requiredByChain(start,target,seen=new Set()){
  if(start===target)return true;if(!start||seen.has(start))return false;seen.add(start);
  const full=path.join(root,start);if(!fs.existsSync(full))return false;
  const source=fs.readFileSync(full,'utf8');const matches=[...source.matchAll(/require\(['"]\.\/(main-v\d+\.js)['"]\)/g)].map(m=>m[1]);
  return matches.some(next=>requiredByChain(next,target,seen));
}
if(!requiredByChain(pkg.main,'main-v200.js') && pkg.main!=='main-v203.js') throw new Error(`Current app ${pkg.version}/${pkg.main} does not preserve the v2.0.0 hosted-web layer.`);
for(const key of ['validate:v200','test:v200'])if(!pkg.scripts?.[key])throw new Error('Missing '+key);
for(const file of ['main-v200.js','main-v198.js','main.js','preload.js'])if(!pkg.build.files.includes(file))throw new Error('electron-builder missing '+file);
const project=JSON.parse(fs.readFileSync(path.join(root,'nexa.project.json'),'utf8'));if(!String(project.application_version||''))throw new Error('nexa.project application version missing');
console.log('Nexa AI v2.0.0 Hosted Web layer validation: OK');
