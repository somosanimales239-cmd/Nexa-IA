'use strict';
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const required=[
  'main-v200.js','main-v198.js','main-v195.js','main.js','preload.js',
  'lib/nexa-web-control-v200.js','webapp/index.html','webapp/app.js','webapp/app.css',
  'scripts/test-v200-web-control.js','package.json','nexa.project.json'
];
for(const file of required){
  const full=path.join(root,file);
  if(!fs.existsSync(full))throw new Error('Missing v2.0.0 dependency: '+file);
  const src=fs.readFileSync(full,'utf8');
  if(src.includes('<<<<<<<')||src.includes('>>>>>>>'))throw new Error('Conflict marker: '+file);
}
const main=fs.readFileSync(path.join(root,'main-v200.js'),'utf8');
for(const token of ["require('./main-v198.js')",'NexaWebControlServer',"loadFile(path.join(__dirname,'src','index.html'))",'32146'])if(!main.includes(token))throw new Error('main-v200 missing '+token);
const server=fs.readFileSync(path.join(root,'lib','nexa-web-control-v200.js'),'utf8');
for(const token of ['/sdapi/v1/txt2img','/sdapi/v1/extra-single-image','/sdapi/v1/sd-models','/api/chat/stream','/api/attachments/stage','/api/knowledge/search','Forge no respondió','x-nexa-web-token'])if(!server.includes(token))throw new Error('web control server missing '+token);
const html=fs.readFileSync(path.join(root,'webapp','index.html'),'utf8');
for(const token of ['Image Studio','Knowledge','Memory','System','Settings','Forge API URL'])if(!html.includes(token))throw new Error('webapp UI missing '+token);
const appjs=fs.readFileSync(path.join(root,'webapp','app.js'),'utf8');
for(const token of ['streamChat','generateForge','stageAttachments','refreshBootstrap','looksLikeImageRequest'])if(!appjs.includes(token))throw new Error('webapp JS missing '+token);
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(pkg.version!=='2.0.0'||pkg.main!=='main-v200.js')throw new Error(`v2.0.0 package entry/version wrong: ${pkg.version} / ${pkg.main}`);
for(const script of ['validate:v200','test:v200'])if(!String(pkg.scripts?.[script]||'').trim())throw new Error('package scripts missing '+script);
const buildFiles=Array.isArray(pkg?.build?.files)?pkg.build.files.map(String):[];
for(const file of ['main-v200.js','main-v198.js','main-v195.js','main.js','preload.js','webapp/**/*'])if(!buildFiles.includes(file))throw new Error('electron-builder missing '+file);
const project=JSON.parse(fs.readFileSync(path.join(root,'nexa.project.json'),'utf8'));
if(String(project.application_version||project.version||'')!=='2.0.0'||String(project.build||'')!=='2.0.0')throw new Error('nexa.project version/build mismatch');
console.log('Nexa AI v2.0.0 Web Control + Forge validation: OK');
