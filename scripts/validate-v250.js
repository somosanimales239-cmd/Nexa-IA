'use strict';
// Nexa v2.5.0 backward-compatibility contract, forward-compatible with v2.8.
const fs=require('fs'),path=require('path'),root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const must=(v,msg)=>{if(!v)throw Error(msg)};
const pkg=JSON.parse(read('package.json')),proj=JSON.parse(read('nexa.project.json'));
const parts=String(pkg.version||'').split('.').map(Number);
must(parts[0]>2||(parts[0]===2&&parts[1]>=5),'App anterior a v2.5.0');
for(const rel of ['lib/developer-runtime-v250.js','lib/hosted-web-agent-v203.js','main-v203.js','lib/developer-autonomous-v280.js','package.json','nexa.project.json']){
 must(fs.existsSync(path.join(root,rel)),'Dependencia perdida v250 '+rel);
 const s=read(rel);must(!s.includes('<<<<<<<')&&!s.includes('>>>>>>>'),'Conflicto de merge '+rel);
}
const runtime=read('lib/developer-runtime-v250.js');
for(const token of ['class DeveloperRuntime','shell:false','allowedRoots','semanticIndex(payload','semanticSearch(payload','browserRun(payload','contextIsolation:true','nodeIntegration:false','sandbox:true','workflowRun(payload','jobResume(payload','securityScan(payload','realPathSafe','symlink/junction','safeChildEnv','redactSecrets','isSensitiveFile','sanitizeForStorage','Terminal bloqueó ejecución inline',"require('node:sqlite')",'migrationsEnabled:false','networkEnabled:false','deploy:{enabled:false}'])must(runtime.includes(token),'Contrato v250 ausente: '+token);
must(pkg.main==='main-v203.js','Entrypoint cambiado');
for(const name of ['validate:v250','test:v250','validate:v203','test:v203'])must(Boolean(pkg.scripts?.[name]),'Script existente perdido: '+name);
must(pkg.build?.files?.includes('lib/**/*'),'Electron debe empacar lib/**/*');
const agent=read('lib/hosted-web-agent-v203.js');
const match=agent.match(/require\(['"]\.\/developer-runtime-v(\d+)['"]\)/);
must(match&&Number(match[1])>=250,'Hosted agent no carga runtime compatible');
must(fs.existsSync(path.join(root,'lib','developer-runtime-v'+match[1]+'.js')),'Runtime activo no existe');
for(const token of ['this.developer=new DeveloperRuntime',"startsWith('developer.')",'runDeveloper(job)','developerConfigPath','developer:artifact','developer:progress'])must(agent.includes(token),'Hosted Web v250 behavior perdido: '+token);
const main=read('main-v203.js'),newAgent=read('lib/developer-autonomous-v280.js');
must(main.includes("require('./main-v198.js')")&&main.includes("loadFile(path.join(__dirname, 'src', 'index.html'))"),'Main perdió cadena estable de Electron');
// v280 remains present for compatibility; the active hook may be v281 or newer.
const activeAgent = main.match(/require\(['"]\.\/lib\/developer-autonomous-v(\d+)['"]\)\.install\(HostedWebAgent\)/);
must(activeAgent,'Ningún agente autónomo está enlazado en Windows');
const activeAgentFile='lib/developer-autonomous-v'+activeAgent[1]+'.js';
must(fs.existsSync(path.join(root,activeAgentFile)),'Falta agente autónomo activo: '+activeAgentFile);
must(read(activeAgentFile).includes("const VERSION = '"+pkg.version+"'"),'Agente autónomo activo y paquete tienen versiones diferentes');
must(newAgent.includes("const VERSION = '2.8.0'"),'Agente v280 de compatibilidad incorrecto');
must(proj.application_version===pkg.version&&proj.build===pkg.version,'Paquete y manifiesto desincronizados');
for(const name of ['developer-runtime-v250','developer-controlled-terminal','developer-electron-browser-agent','developer-semantic-code-index','developer-persistent-workflows'])must(proj.features?.includes(name),'Feature estable v250 perdida: '+name);
console.log('Contratos Developer v250 preservados; agente nuevo v280 separado: OK');
