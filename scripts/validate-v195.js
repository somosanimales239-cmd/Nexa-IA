'use strict';
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const required=['main-v195.js','main-v194.js','main-v193.js','lib/image-intelligence-v195.js','src/image-intelligence-v195.js','lib/premium-prompt-compiler-v189.js','lib/visual-review-v188.js','lib/chat-routing-v190.js','scripts/test-v195-image-intelligence.js','package.json','nexa.project.json'];
for(const file of required){const full=path.join(root,file);if(!fs.existsSync(full))throw new Error('Missing v1.9.5 dependency: '+file);const source=fs.readFileSync(full,'utf8');if(source.includes('<<<<<<<')||source.includes('>>>>>>>'))throw new Error('Conflict marker: '+file);}
const main=fs.readFileSync(path.join(root,'main-v195.js'),'utf8');
for(const token of ["require('./main-v194.js')",'Intelligence.installCompiler','Intelligence.installRouting',"channel === 'image:generate'",'finalizeOutput',"loadFile(path.join(__dirname,'src','index.html'))",'image-intelligence-v195.js'])if(!main.includes(token))throw new Error('main-v195 missing '+token);
const engine=fs.readFileSync(path.join(root,'lib','image-intelligence-v195.js'),'utf8');
for(const token of ['isVisualCreationIntent','splitPromptSections','extractTechnicalSpec','adaptNamedStyles','requirementGraph','installVisualReview','STRICT STYLE LOCK','ORIGINALITY REPAIR','upscaleWithComfy','applyChromaTransparency','finalizeOutput'])if(!engine.includes(token))throw new Error('Image Intelligence missing '+token);
const renderer=fs.readFileSync(path.join(root,'src','image-intelligence-v195.js'),'utf8');if(!renderer.includes('visualCreationIntent')||!renderer.includes('personage')||!renderer.includes('__nexaV195'))throw new Error('renderer intent patch incomplete');
function reqs(file){if(!fs.existsSync(path.join(root,file)))return[];const src=fs.readFileSync(path.join(root,file),'utf8');return[...src.matchAll(/require\(['"]\.\/(main-v\d+\.js)['"]\)/g)].map(m=>m[1]);}
function chain(start,target,seen=new Set()){if(start===target)return true;if(!start||seen.has(start)||!fs.existsSync(path.join(root,start)))return false;seen.add(start);return reqs(start).some(next=>chain(next,target,seen));}
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));if(pkg.version!=='1.9.5'||pkg.main!=='main-v195.js')throw new Error(`v1.9.5 package entry/version wrong: ${pkg.version} / ${pkg.main}`);if(!chain(pkg.main,'main-v194.js'))throw new Error('v1.9.5 does not chain to v1.9.4');
for(const script of ['validate:v195','test:v195','validate:v194','test:v194','validate:v193','test:v193'])if(!String(pkg.scripts?.[script]||'').trim())throw new Error('package scripts missing '+script);
const buildFiles=Array.isArray(pkg?.build?.files)?pkg.build.files.map(String):[];for(const file of ['main-v195.js','main-v194.js','main-v193.js','main-v192.js','main-v191.js','main-v190.js','main-v189.js','main-v188.js','main.js','preload.js'])if(!buildFiles.includes(file))throw new Error('electron-builder missing '+file);
const project=JSON.parse(fs.readFileSync(path.join(root,'nexa.project.json'),'utf8'));if(String(project.application_version||project.version||'')!=='1.9.5'||String(project.build||'')!=='1.9.5')throw new Error('nexa.project version/build mismatch');
console.log('Nexa AI v1.9.5 Image Intelligence validation: OK');
