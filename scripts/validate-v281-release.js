'use strict';
// Original v2.8.1 release contract plus deterministic append-recovery test gate.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const pkg=JSON.parse(read('package.json')),project=JSON.parse(read('nexa.project.json'));
assert.equal(pkg.version,'2.8.1');assert.equal(pkg.main,'main-v203.js');
for(const k of ['version','application_version','build'])assert.equal(project[k],pkg.version);
for(const rel of ['main-v203.js','lib/developer-autonomous-v281.js','scripts/test-developer-autonomous-v281.js','scripts/test-developer-web-v281.js','scripts/validate-v260.js','scripts/test-developer-autonomous-v281-recovery.js'])assert(fs.existsSync(path.join(root,rel)),'Missing: '+rel);
const main=read('main-v203.js'),agent=read('lib/developer-autonomous-v281.js');
assert(main.includes("require('./main-v198.js')"),'Electron stable chain was modified');
assert(main.includes("require('./lib/developer-autonomous-v281').install(HostedWebAgent)"),'Active agent was not installed');
assert(main.includes("version: '2.8.1'"),'Active agent version mismatch');
for(const fragment of ["const VERSION = '2.8.1'", "const MODEL = 'qwen2.5-coder:7b'", "type==='developer.agent.status'", "type==='developer.agent.report'", 'function readReport(', 'async function runAgent(', 'BUILD_ID', 'const SYSTEM=['])assert(agent.includes(fragment),'Missing: '+fragment);
for(const script of ['validate:v281','test:v281','validate:v280','test:v280','validate:v260','test:v260'])assert(pkg.scripts[script],'Missing gate '+script);
assert(pkg.scripts.validate.startsWith('npm run validate:v281 && npm run test:v281 && '),'v281 not in release gate');
assert(pkg.build.files.includes('lib/**/*'),'Windows packager missing Developer agent');
assert(project.features.includes('developer-autonomous-v281-reliability'));
assert(agent.includes('verifiedSingleAppendGoal('),'Append recovery guard missing');
assert(agent.includes('append-already-applied'),'Idempotent append recovery missing');
// Run this addition from the existing validate:v281 gate. Never remove the old
// v281 tests, whose expectations and compatibility remain important.
execFileSync(process.execPath,['--test','scripts/test-developer-autonomous-v281-recovery.js'],{cwd:root,stdio:'inherit',timeout:45000});
console.log('Nexa 2.8.1 integration, version synchronization, recovery and stable Electron chain: OK');
