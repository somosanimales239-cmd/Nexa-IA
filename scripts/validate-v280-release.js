'use strict';
// Nexa App Builder guard: stop the build before packaging if any v280 file
// is omitted, mismatched or the existing stable Electron chain is altered.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const pkg=JSON.parse(read('package.json'));
const info=JSON.parse(read('nexa.project.json'));
assert(['2.8.0','2.8.1'].includes(pkg.version));assert.equal(pkg.main,'main-v203.js');
for(const k of ['version','application_version','build'])assert.equal(info[k],pkg.version);
assert(info.features.includes('developer-autonomous-v280'));
const paths=['main-v203.js','lib/developer-autonomous-v280.js','scripts/test-developer-autonomous-v280.js',
'scripts/validate-v250.js','scripts/validate-v251.js','scripts/validate-v260.js','scripts/validate-v280-release.js'];
for(const rel of paths){assert(fs.existsSync(path.join(root,rel)),'FILE_MISSING '+rel);const code=read(rel);assert(!code.split(/\r?\n/).some(line=>line.startsWith('<'.repeat(7)+' ')||line.startsWith('>'.repeat(7)+' ')),'MERGE_CONFLICT '+rel)}
const main=read('main-v203.js');const coder=read('lib/developer-autonomous-v280.js');
assert(main.includes("require('./main-v198.js')"),'Nexa stable Electron chain missing');
assert(main.includes("require('./lib/developer-autonomous-v281').install(HostedWebAgent)"),'AGENT_NOT_CONNECTED');
assert(main.includes("version: '"+pkg.version+"'"),'APP_AGENT_VERSION_MISMATCH');
for(const token of ["const VERSION = '2.8.0'", "const MODEL = 'qwen2.5-coder:7b'",'function makeSnapshot(',
  'function workspaceEdit(', 'function readArtifact(',"type==='developer.agent.status'", "type!=='developer.agent.run'",
  'async function probeOllama(', 'developer-17m-hard-timeout'])assert(coder.includes(token),'AGENT_MISSING_'+token);
for(const key of ['validate:v280','test:v280','validate:v260','test:v260','validate:v251','test:v251','validate:v250','test:v250'])assert(pkg.scripts?.[key],'SCRIPT_MISSING_'+key);
assert(pkg.scripts.validate.includes('npm run validate:v280 && npm run test:v280 && '),'BUILD_GATE_NOT_ENABLED');
assert(pkg.build.files.includes('lib/**/*'),'BUILDER_MISSING_LIB');
console.log('Nexa v2.8.0 full bundle safety gate OK; stable Chat/Image chain preserved');
