'use strict';
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const required=['main-v197.js','main-v195.js','lib/image-intelligence-v197.js','lib/highres-pipeline-v197.js','src/image-intelligence-v197.js','lib/premium-prompt-compiler-v189.js','lib/visual-review-v188.js','lib/chat-routing-v190.js','scripts/test-v197-image-intelligence.js','package.json','nexa.project.json'];
for(const file of required){const full=path.join(root,file);if(!fs.existsSync(full))throw new Error('Missing v1.9.7 dependency: '+file);const source=fs.readFileSync(full,'utf8');if(source.includes('<<<<<<<')||source.includes('>>>>>>>'))throw new Error('Conflict marker: '+file);}
const main=fs.readFileSync(path.join(root,'main-v197.js'),'utf8');
for(const token of ["require('./main-v195.js')",'prepareRuntimePlan','inspectComfyRuntime','checkpointRouting',"loadFile(path.join(__dirname,'src','index.html'))",'image-intelligence-v197.js'])if(!main.includes(token))throw new Error('main-v197 missing '+token);
const engine=fs.readFileSync(path.join(root,'lib','image-intelligence-v197.js'),'utf8');
for(const token of ['prepareRuntimePlan','inspectComfyRuntime','STYLE AUTHORITY','COMFY CHECKPOINT DECISION','HIGH-RES PIPELINE','chooseHighResolutionPlan','HighRes.runHighResolutionPipeline','3840','2160','finalizeOutput'])if(!engine.includes(token))throw new Error('Image Intelligence v197 missing '+token);
const pipeline=fs.readFileSync(path.join(root,'lib','highres-pipeline-v197.js'),'utf8');
for(const token of ['chooseHighResolutionPlan','latentRefineWithComfy','exactScaleWithComfy','CheckpointLoaderSimple','LatentUpscale','KSampler','runHighResolutionPipeline'])if(!pipeline.includes(token))throw new Error('HighRes pipeline missing '+token);
const renderer=fs.readFileSync(path.join(root,'src','image-intelligence-v197.js'),'utf8');if(!renderer.includes('visualCreationIntent')||!renderer.includes('personage')||!renderer.includes('__nexaV197'))throw new Error('renderer intent patch incomplete');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));if(pkg.version!=='1.9.7'||pkg.main!=='main-v197.js')throw new Error(`v1.9.7 package entry/version wrong: ${pkg.version} / ${pkg.main}`);for(const script of ['validate:v197','test:v197'])if(!String(pkg.scripts?.[script]||'').trim())throw new Error('package scripts missing '+script);
const buildFiles=Array.isArray(pkg?.build?.files)?pkg.build.files.map(String):[];for(const file of ['main-v197.js','main-v195.js','main-v194.js','main-v193.js','main-v192.js','main-v191.js','main-v190.js','main-v189.js','main-v188.js','main.js','preload.js'])if(!buildFiles.includes(file))throw new Error('electron-builder missing '+file);
const project=JSON.parse(fs.readFileSync(path.join(root,'nexa.project.json'),'utf8'));if(String(project.application_version||project.version||'')!=='1.9.7'||String(project.build||'')!=='1.9.7')throw new Error('nexa.project version/build mismatch');
console.log('Nexa AI v1.9.7 High-Resolution 4K Pipeline validation: OK');
