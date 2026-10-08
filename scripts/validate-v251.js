'use strict';
const fs=require('fs');
function must(v,m){if(!v)throw new Error(m);}
function read(p){return fs.readFileSync(p,'utf8');}
for(const rel of ['lib/developer-runtime-v251.js','lib/hosted-web-agent-v203.js','package.json','nexa.project.json'])must(fs.existsSync(rel),'Missing '+rel);
const rt=read('lib/developer-runtime-v251.js');
for(const token of ["const VERSION = '2.5.1'",'commandAvailability()','controlledSpawnSpec(command,args=[])','runControlledProcess({cwd,command,args=[]','Comando no instalado o no disponible en PATH','commandAvailability:this.commandAvailability()','available:!!resolveOnPath(\'git\')'])must(rt.includes(token),'Runtime stabilization token missing: '+token);
const agent=read('lib/hosted-web-agent-v203.js');must(agent.includes("require('./developer-runtime-v251')"),'Hosted agent must load runtime v251');must(agent.includes("const VERSION = '2.5.1'"),'Hosted agent version mismatch');
const pkg=JSON.parse(read('package.json'));must(pkg.version==='2.5.1','package version mismatch');must(pkg.main==='main-v203.js','main entry changed unexpectedly');
const proj=JSON.parse(read('nexa.project.json'));must(proj.version==='2.5.1','project version mismatch');
console.log('validate-v251: PASS');
