'use strict';
// v2.5.1 Windows stabilization invariant, independent from new agent version.
const fs=require('fs'),path=require('path'),root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const must=(v,m)=>{if(!v)throw Error(m)};
const pkg=JSON.parse(read('package.json')),manifest=JSON.parse(read('nexa.project.json'));
for(const rel of ['lib/developer-runtime-v251.js','lib/hosted-web-agent-v203.js','package.json','nexa.project.json','main-v203.js','lib/developer-autonomous-v280.js']){
 must(fs.existsSync(path.join(root,rel)),'Missing v251 dependency: '+rel);
 const src=read(rel);must(!src.includes('<<<<<<<')&&!src.includes('>>>>>>>'),'Merge conflict: '+rel);
}
const runtime=read('lib/developer-runtime-v251.js');
for(const token of ["const VERSION = '2.5.1'",'commandAvailability()','controlledSpawnSpec(command,args=[])','runControlledProcess({cwd,command,args=[]','Comando no instalado o no disponible en PATH','commandAvailability:this.commandAvailability()',"available:!!resolveOnPath('git')"])must(runtime.includes(token),'v251 Windows contract missing: '+token);
for(const k of ['validate:v251','test:v251','validate:v250','test:v250'])must(Boolean(pkg.scripts?.[k]),'Preserved script missing: '+k);
const agent=read('lib/hosted-web-agent-v203.js');
const active=agent.match(/require\(['"]\.\/developer-runtime-v(\d+)['"]\)/);
must(active&&Number(active[1])>=251,'Hosted Web no carga Developer Runtime >=251');
must(fs.existsSync(path.join(root,'lib','developer-runtime-v'+active[1]+'.js')),'Runtime activo no existe');
const main=read('main-v203.js');must(main.includes("require('./lib/developer-autonomous-v280').install(HostedWebAgent)"),'v280 no integrado con Windows');
must(read('lib/developer-autonomous-v280.js').includes("const VERSION = '2.8.0'"),'v280 source incorrecto');
must(pkg.main==='main-v203.js'&&pkg.version==='2.8.0'&&manifest.application_version===pkg.version&&manifest.build===pkg.version,'Build/version no consistente');
for(const f of ['developer-runtime-v251','developer-windows-cmd-wrapper-stabilization','developer-command-availability','developer-safe-internal-git-runner'])must(manifest.features?.includes(f),'Se perdió función estable: '+f);
console.log('v2.5.1 Windows stabilization preserved and v2.8.0 activated: OK');
