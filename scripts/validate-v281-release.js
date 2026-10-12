'use strict';
// Original v2.8.1 release contract plus deterministic append-recovery test gate.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const pkg=JSON.parse(read('package.json')),project=JSON.parse(read('nexa.project.json'));
assert.equal(pkg.version,'2.8.1');assert.equal(pkg.main,'main-v203.js');
for(const k of ['version','application_version','build'])assert.equal(project[k],pkg.version);
for(const rel of ['main-v203.js','lib/developer-autonomous-v281.js','scripts/test-developer-autonomous-v281.js','scripts/test-developer-web-v281.js','scripts/validate-v260.js','scripts/test-developer-autonomous-v281-recovery.js','scripts/test-developer-autonomous-v281-transactional.js'])assert(fs.existsSync(path.join(root,rel)),'Missing: '+rel);
const main=read('main-v203.js'),agent=read('lib/developer-autonomous-v281.js');
assert(main.includes("require('./main-v198.js')"),'Electron stable chain was modified');
assert(main.includes("require('./lib/developer-autonomous-v281').install(HostedWebAgent)"),'Active agent was not installed');
assert(main.includes("require('./lib/developer-webv2-bridge').install(HostedWebAgent)"),'Web Developer v2 bridge not loaded');
assert(fs.existsSync(path.join(root,'lib/developer-webv2-bridge.js')),'Missing website-driven executor');
assert(main.includes("version: '2.8.1'"),'Active agent version mismatch');
for(const fragment of ["const VERSION = '2.8.1'", "const MODEL = 'qwen2.5-coder:7b'", "type==='developer.agent.status'", "type==='developer.agent.report'", 'function readReport(', 'async function runAgent(', 'BUILD_ID', 'const SYSTEM=['])assert(agent.includes(fragment),'Missing: '+fragment);
for(const script of ['validate:v281','test:v281','validate:v280','test:v280','validate:v260','test:v260'])assert(pkg.scripts[script],'Missing gate '+script);
assert(pkg.scripts.validate.startsWith('npm run validate:v281 && npm run test:v281 && '),'v281 not in release gate');
assert(pkg.build.files.includes('lib/**/*'),'Windows packager missing Developer agent');
assert(project.features.includes('developer-autonomous-v281-reliability'));
assert(agent.includes('verifiedSingleAppendGoal('),'Append recovery guard missing');
assert(agent.includes('append-already-applied'),'Idempotent append recovery missing');
for (const marker of ['async function transactionalEdit(', 'function obviousPhpBoundaryError(', 'function verifyTaskPlacement(', 'LINT_REAL:', 'TEXTO_DUPLICADO:', 'const unverifiedExecutable=']) assert(agent.includes(marker),'Transactional guard missing: '+marker);
// Run original release integration tests without disabling or replacing any gate.
execFileSync(process.execPath,['--test','scripts/test-developer-autonomous-v281-recovery.js','scripts/test-developer-autonomous-v281-transactional.js','scripts/test-developer-webv2-control.js','scripts/test-developer-webv2-boot.js'],{cwd:root,stdio:'inherit',timeout:90000});
// New isolated Aider tests: fail the existing gate if the Worker regresses.
for(const rel of ['lib/nexa-aider-worker.js','lib/nexa-aider-analyzer.py','scripts/test-nexa-aider-worker.js'])assert(fs.existsSync(path.join(root,rel)),'Missing Aider file: '+rel);
assert(main.includes("require('./lib/nexa-aider-worker')"),'Aider Worker is not connected to Windows bootstrap');
execFileSync(process.execPath,['--check','lib/nexa-aider-worker.js'],{cwd:root,stdio:'inherit'});
execFileSync(process.execPath,['--test','scripts/test-nexa-aider-worker.js','scripts/test-nexa-aider-boot.js'],{cwd:root,stdio:'inherit',timeout:30000});
console.log('Nexa 2.8.1 integration, version synchronization, recovery, Aider isolation and stable Electron chain: OK');
