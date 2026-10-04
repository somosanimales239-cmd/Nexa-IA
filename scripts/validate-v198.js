'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const required = [
  'main-v198.js',
  'main-v195.js',
  'lib/image-intelligence-v198.js',
  'lib/highres-pipeline-v198.js',
  'src/image-intelligence-v198.js',
  'lib/premium-prompt-compiler-v189.js',
  'lib/visual-review-v188.js',
  'lib/chat-routing-v190.js',
  'scripts/test-v198-image-completion.js',
  'package.json',
  'nexa.project.json',
];

for (const file of required) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) throw new Error('Missing v1.9.8 dependency: ' + file);
  const source = fs.readFileSync(full, 'utf8');
  if (source.includes('<<<<<<<') || source.includes('>>>>>>>')) throw new Error('Conflict marker: ' + file);
}

const main = fs.readFileSync(path.join(root, 'main-v198.js'), 'utf8');
for (const token of [
  "require('./main-v195.js')",
  'prepareRuntimePlan',
  'recoverTimedOutGeneration',
  'Comfy History Rescue',
  'image-intelligence-v198.js',
  "loadFile(path.join(__dirname,'src','index.html'))",
]) {
  if (!main.includes(token)) throw new Error('main-v198 missing ' + token);
}

const engine = fs.readFileSync(path.join(root, 'lib', 'image-intelligence-v198.js'), 'utf8');
for (const token of [
  'prepareRuntimePlan',
  'inspectComfyRuntime',
  'STYLE AUTHORITY',
  'COMFY CHECKPOINT DECISION',
  'HIGH-RES PIPELINE',
  'chooseHighResolutionPlan',
  'HighRes.runHighResolutionPipeline',
  '3840',
  '2160',
  'finalizeOutput',
]) {
  if (!engine.includes(token)) throw new Error('Image Intelligence v198 missing ' + token);
}

const pipeline = fs.readFileSync(path.join(root, 'lib', 'highres-pipeline-v198.js'), 'utf8');
for (const token of [
  'adaptive-high-resolution-4k-pipeline',
  'waitForComfyImage',
  'ComfyUI sigue trabajando',
  'latentRefineWithComfy',
  'exactScaleWithComfy',
  'CheckpointLoaderSimple',
  'LatentUpscale',
  'KSampler',
  'runHighResolutionPipeline',
]) {
  if (!pipeline.includes(token)) throw new Error('HighRes pipeline missing ' + token);
}

const renderer = fs.readFileSync(path.join(root, 'src', 'image-intelligence-v198.js'), 'utf8');
if (!renderer.includes('visualCreationIntent') || !renderer.includes('personage') || !renderer.includes('__nexaV198')) {
  throw new Error('renderer intent patch incomplete');
}

function requiredMain(file) {
  if (!fs.existsSync(path.join(root, file))) return [];
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  return [...source.matchAll(/require\(['"]\.\/(main-v\d+\.js)['"]\)/g)].map(m => m[1]);
}
function chainsTo(start, target, seen = new Set()) {
  if (start === target) return true;
  if (!start || seen.has(start)) return false;
  seen.add(start);
  return requiredMain(start).some(next => chainsTo(next, target, seen));
}
function versionAtLeast(value, major, minor, patch) {
  const parts = String(value || '').split('.').map(x => Number(x) || 0);
  const target = [major, minor, patch];
  for (let i=0; i<3; i++) { if (parts[i] > target[i]) return true; if (parts[i] < target[i]) return false; }
  return true;
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!versionAtLeast(pkg.version, 1, 9, 8) || !chainsTo(pkg.main, 'main-v198.js')) {
  throw new Error(`v1.9.8 layer not reachable from current package: ${pkg.version} / ${pkg.main}`);
}
for (const script of ['validate:v198', 'test:v198']) {
  if (!String(pkg.scripts?.[script] || '').trim()) throw new Error('package scripts missing ' + script);
}
const buildFiles = Array.isArray(pkg?.build?.files) ? pkg.build.files.map(String) : [];
for (const file of ['main-v198.js', 'main-v195.js', 'main-v194.js', 'main-v193.js', 'main-v192.js', 'main-v191.js', 'main-v190.js', 'main-v189.js', 'main-v188.js', 'main.js', 'preload.js']) {
  if (!buildFiles.includes(file)) throw new Error('electron-builder missing ' + file);
}

const project = JSON.parse(fs.readFileSync(path.join(root, 'nexa.project.json'), 'utf8'));
if (!versionAtLeast(project.application_version || project.version, 1, 9, 8) || !versionAtLeast(project.build, 1, 9, 8)) {
  throw new Error('nexa.project is older than the v1.9.8 layer');
}

console.log('Nexa AI v1.9.8 completion-safe 4K pipeline validation: OK');
