'use strict';
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const required=['main-v200.js','main-v198.js','lib/hosted-web-agent-v200.js','scripts/test-v200-hosted-web-agent.js','package.json','nexa.project.json'];
for(const file of required){const full=path.join(root,file);if(!fs.existsSync(full))throw new Error('Missing v2.0.0 dependency: '+file);const s=fs.readFileSync(full,'utf8');if(s.includes('<<<<<<<')||s.includes('>>>>>>>'))throw new Error('Conflict marker: '+file);}
const main=fs.readFileSync(path.join(root,'main-v200.js'),'utf8');
for(const token of ["require('./main-v198.js')",'HostedWebAgent',"loadFile(path.join(__dirname, 'src', 'index.html'))"])if(!main.includes(token))throw new Error('main-v200 missing '+token);
const agent=fs.readFileSync(path.join(root,'lib','hosted-web-agent-v200.js'),'utf8');
for(const token of ['api/agent/next.php','chat.start','forge.generate','sdapi/v1/txt2img','sdapi/v1/extra-single-image','chat-attachments:stage','X-Nexa-Agent-Token'])if(!agent.includes(token))throw new Error('Hosted agent missing '+token);
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));if(pkg.version!=='2.0.0'||pkg.main!=='main-v200.js')throw new Error(`v2.0.0 package entry wrong: ${pkg.version}/${pkg.main}`);for(const key of ['validate:v200','test:v200'])if(!pkg.scripts?.[key])throw new Error('Missing '+key);for(const file of ['main-v200.js','main-v198.js','main.js','preload.js'])if(!pkg.build.files.includes(file))throw new Error('electron-builder missing '+file);
const project=JSON.parse(fs.readFileSync(path.join(root,'nexa.project.json'),'utf8'));if(String(project.application_version)!=='2.0.0'||String(project.build)!=='2.0.0')throw new Error('nexa.project mismatch');
console.log('Nexa AI v2.0.0 Hosted Web Agent validation: OK');
