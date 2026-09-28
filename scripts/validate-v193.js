'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const required = [
  'main-v193.js','main-v192.js','main-v191.js','main-v190.js','main-v189.js','main-v188.js','main.js','preload.js',
  'lib/visual-prompt-writer-v193.js','lib/premium-prompt-compiler-v189.js',
  'scripts/test-v193-prompt-writer.js','package.json','nexa.project.json',
];
for (const file of required) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) throw new Error('Missing v1.9.3 dependency: ' + file);
  const source = fs.readFileSync(full, 'utf8');
  if (source.includes('<<<<<<<') || source.includes('>>>>>>>')) throw new Error('Conflict marker: ' + file);
}
const main = fs.readFileSync(path.join(root, 'main-v193.js'), 'utf8');
for (const token of ["require('./main-v192.js')", "channel === 'chat:start'", 'VisualPromptWriter.wrapEvent', 'injectSystemSteering', 'store:get', "loadFile(path.join(__dirname, 'src', 'index.html'))", "preload: path.join(__dirname, 'preload.js')"]) {
  if (!main.includes(token)) throw new Error('main-v193 missing ' + token);
}
const writer = fs.readFileSync(path.join(root, 'lib', 'visual-prompt-writer-v193.js'), 'utf8');
for (const token of ['responseLooksRejected','compilePromptPackage','adaptSimilarityRequest','Premium.compile','senderProxy','chat:token','chat:done','fallbackAllowed']) {
  if (!writer.includes(token)) throw new Error('visual-prompt-writer-v193 missing ' + token);
}
function requiresOf(file) {
  if (!fs.existsSync(path.join(root, file))) return [];
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  return [...src.matchAll(/require\(['"]\.\/(main-v\d+\.js)['"]\)/g)].map(m => m[1]);
}
function chainsTo(start, target, seen = new Set()) {
  if (start === target) return true;
  if (!start || seen.has(start) || !fs.existsSync(path.join(root, start))) return false;
  seen.add(start);
  return requiresOf(start).some(next => chainsTo(next, target, seen));
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!pkg.main || !chainsTo(pkg.main, 'main-v193.js')) throw new Error('Current entry does not transitively chain to main-v193.js: ' + pkg.main);
if (!chainsTo(pkg.main, 'main-v192.js')) throw new Error('Current entry does not preserve the v1.9.2 chain: ' + pkg.main);
for (const script of ['validate:v193','test:v193','validate:v192','test:v192','validate:v191','test:v191','validate:v190','test:v190']) {
  if (!String(pkg.scripts?.[script] || '').trim()) throw new Error('package scripts missing ' + script);
}
if (!String(pkg.scripts.validate || '').includes('validate:v193') || !String(pkg.scripts.validate || '').includes('test:v193')) throw new Error('global validate does not include v1.9.3 checks');
const buildFiles = Array.isArray(pkg?.build?.files) ? pkg.build.files.map(String) : [];
for (const file of ['main-v193.js','main-v192.js','main-v191.js','main-v190.js','main-v189.js','main-v188.js','main.js','preload.js']) {
  if (!buildFiles.includes(file)) throw new Error('electron-builder missing ' + file);
}
const project = JSON.parse(fs.readFileSync(path.join(root, 'nexa.project.json'), 'utf8'));
const activeVersion=String(pkg.version||''); if (String(project.application_version || project.version || '') !== activeVersion || String(project.build || '') !== activeVersion) throw new Error('nexa.project version/build mismatch');
console.log(`Nexa AI v1.9.3 layer validation: OK (active entry: ${pkg.main}, package ${pkg.version})`);
