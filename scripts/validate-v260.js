'use strict';
// Preserve v2.6 dedicated Qwen Coder while allowing v2.8.1 isolated agent.
const fs=require('fs'),path=require('path'),root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const must=(v,m)=>{if(!v)throw Error(m)};
for(const rel of ['lib/developer-runtime-v260.js','lib/hosted-web-agent-v203.js','lib/developer-autonomous-v281.js','main-v203.js','package.json','nexa.project.json']){
 must(fs.existsSync(path.join(root,rel)),'Falta dependencia Developer: '+rel);
 const src=read(rel);must(!src.includes('<<<<<<<')&&!src.includes('>>>>>>>'),'Conflicto de merge: '+rel);
}
const runtime=read('lib/developer-runtime-v260.js');
for(const token of ["const VERSION = '2.6.0'","model:'qwen2.5-coder:7b'","case'developer.ai.status'","case'developer.ai.generate'",'async aiGenerate(payload={},hooks={})',"'api/chat'",'Dedicated Nexa Developer coder brain'])must(runtime.includes(token),'v260 feature missing: '+token);
const hosted=read('lib/hosted-web-agent-v203.js');
must(hosted.includes("require('./developer-runtime-v260')"),'Hosted agent dejó de cargar el runtime v260');
must(hosted.includes("const VERSION = '2.6.0'"),'Runtime stable v260 unexpectedly changed');
const main=read('main-v203.js');
must(main.includes("require('./lib/developer-autonomous-v281').install(HostedWebAgent)"),'Activación explícita v280 perdida');
const next=read('lib/developer-autonomous-v281.js');
for(const t of ["const VERSION = '2.8.1'", "const MODEL = 'qwen2.5-coder:7b'", "type==='developer.agent.status'", "type!=='developer.agent.run'", "type==='developer.agent.artifact'", 'autonomous-v281','watchActive=async'])must(next.includes(t),'Agente v280 falta: '+t);
const pkg=JSON.parse(read('package.json')),manifest=JSON.parse(read('nexa.project.json'));
must(pkg.version==='2.8.1'&&pkg.main==='main-v203.js','Versión nueva incorrecta');
must(manifest.application_version===pkg.version&&manifest.build===pkg.version,'Manifiesto versión desactualizado');
for(const k of ['validate:v260','test:v260','validate:v251','test:v251','validate:v250','test:v250','test:v280'])must(Boolean(pkg.scripts?.[k]),'Script perdido: '+k);
must(manifest.features?.includes('developer-qwen2.5-coder-7b'),'Modelo previo desapareció');
must(manifest.features?.includes('developer-autonomous-v281-reliability'),'Falta declarar agente v281 de confiabilidad en manifiesto');
console.log('v2.6 runtime preserved; autonomous v2.8.0 integrated and versions consistent: OK');
