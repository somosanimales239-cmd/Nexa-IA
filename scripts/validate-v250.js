'use strict';
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
function read(rel){return fs.readFileSync(path.join(root,rel),'utf8');}
function must(cond,msg){if(!cond)throw new Error(msg);}
for(const rel of ['lib/developer-runtime-v250.js','lib/hosted-web-agent-v203.js','package.json','nexa.project.json','main-v203.js']){
  const full=path.join(root,rel);must(fs.existsSync(full),'Missing v2.5.0 dependency: '+rel);
  const s=fs.readFileSync(full,'utf8');must(!s.includes('<<<<<<<')&&!s.includes('>>>>>>>'),'Conflict marker: '+rel);
}
const runtime=read('lib/developer-runtime-v250.js');
for(const token of [
  'class DeveloperRuntime','shell:false','allowedRoots','semanticIndex(payload','semanticSearch(payload','browserRun(payload',
  'contextIsolation:true','nodeIntegration:false','sandbox:true','workflowRun(payload','jobResume(payload','securityScan(payload',
  'realPathSafe','symlink/junction','safeChildEnv','redactSecrets','isSensitiveFile','sanitizeForStorage','Terminal bloqueó ejecución inline',
  "require('node:sqlite')",'migrationsEnabled:false','networkEnabled:false','deploy:{enabled:false}'
])must(runtime.includes(token),'Developer Runtime missing token: '+token);
const agent=read('lib/hosted-web-agent-v203.js');
for(const token of ["require('./developer-runtime-v250')","const VERSION = '2.5.0'",'this.developer=new DeveloperRuntime',
  "startsWith('developer.')",'runDeveloper(job)','developerConfigPath','developer:artifact','developer:progress'
])must(agent.includes(token),'Hosted agent missing v2.5.0 token: '+token);
const main=read('main-v203.js');
must(main.includes("require('./main-v198.js')"),'main-v203 must preserve main-v198 chain');
must(main.includes("loadFile(path.join(__dirname, 'src', 'index.html'))"),'App Builder BrowserWindow.loadFile detector must remain present');
const pkg=JSON.parse(read('package.json'));
must(pkg.version==='2.5.0','package version must be 2.5.0');
must(pkg.main==='main-v203.js','main entry must remain main-v203.js');
for(const key of ['validate:v250','test:v250','validate:v203','test:v203'])must(Boolean(pkg.scripts?.[key]),'Missing package script '+key);
must(Array.isArray(pkg.build?.files)&&pkg.build.files.includes('lib/**/*'),'electron-builder must package lib/**/*');
const project=JSON.parse(read('nexa.project.json'));
must(project.application_version==='2.5.0'&&project.build==='2.5.0','nexa.project version mismatch');
for(const feature of ['developer-runtime-v250','developer-controlled-terminal','developer-electron-browser-agent','developer-semantic-code-index','developer-persistent-workflows'])must(project.features?.includes(feature),'Missing project feature '+feature);
console.log('Nexa AI v2.5.0 Developer Runtime validation: OK');
