'use strict';
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const required=['main-v203.js','lib/hosted-web-agent-v203.js','scripts/test-v203-hosted-web-sync.js','package.json','nexa.project.json'];
for(const file of required){const full=path.join(root,file);if(!fs.existsSync(full))throw new Error('Missing v2.0.3 dependency: '+file);const s=fs.readFileSync(full,'utf8');if(s.includes('<<<<<<<')||s.includes('>>>>>>>'))throw new Error('Conflict marker: '+file);}
const main=fs.readFileSync(path.join(root,'main-v203.js'),'utf8');
for(const token of ["require('./main-v198.js')",'HostedWebAgent','hosted-web-agent-v203',"loadFile(path.join(__dirname, 'src', 'index.html'))"])if(!main.includes(token))throw new Error('main-v203 missing '+token);
const agent=fs.readFileSync(path.join(root,'lib','hosted-web-agent-v203.js'),'utf8');
for(const token of ['runtimeStatus','runtimeStatus','compactStore','forgeStatus','engine:status','nexa.dashboard','api/agent/heartbeat.php','api/agent/next.php'])if(!agent.includes(token))throw new Error('Hosted v203 agent missing '+token);
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(pkg.version!=='2.0.3'||pkg.main!=='main-v203.js')throw new Error(`v2.0.3 package entry wrong: ${pkg.version}/${pkg.main}`);
for(const key of ['validate:v203','test:v203','validate:v200','test:v200'])if(!pkg.scripts?.[key])throw new Error('Missing '+key);
for(const file of ['main-v203.js','main-v200.js','main-v198.js','main.js','preload.js'])if(!pkg.build.files.includes(file))throw new Error('electron-builder missing '+file);
const project=JSON.parse(fs.readFileSync(path.join(root,'nexa.project.json'),'utf8'));
if(String(project.application_version)!=='2.0.3'||String(project.build)!=='2.0.3')throw new Error('nexa.project v2.0.3 mismatch');
console.log('Nexa AI v2.0.3 Hosted Web synchronization validation: OK');
