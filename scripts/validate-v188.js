'use strict';

// Nexa v1.8.8 base-runtime validator.
// IMPORTANT: v1.8.8 is now a reusable base layer. Newer entrypoints such as
// main-v189.js may legitimately wrap main-v188.js, so this validator must not
// require package.json itself to remain pinned to v1.8.8/main-v188.js.

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const required = [
  'main-v188.js',
  'package.json',
  'nexa.project.json',
  'lib/visual-review-v188.js',
  'lib/visual-review-v185.js',
  'src/reference-panel-v188.js',
  'README-V1.8.8.md',
];

for (const file of required) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) throw new Error('Missing ' + file);
  const source = fs.readFileSync(full, 'utf8');
  if (source.includes('<<<<<<<') || source.includes('>>>>>>>')) {
    throw new Error('Conflict marker ' + file);
  }
}

const main188 = fs.readFileSync(path.join(root, 'main-v188.js'), 'utf8');
for (const token of [
  'BrowserWindow',
  "loadFile(path.join(__dirname, 'src', 'index.html'))",
  "require('./main.js')",
  'compilePremiumBrief',
  'analyzeReferences',
  'referenceAnchor',
  'reference-panel-v188.js',
]) {
  if (!main188.includes(token)) throw new Error('main-v188 missing ' + token);
}

const visual188 = fs.readFileSync(path.join(root, 'lib', 'visual-review-v188.js'), 'utf8');
for (const token of [
  'PREMIUM POSITIVE PROMPT',
  'PREMIUM NEGATIVE PROMPT',
  'E019',
  'reference_match',
  'uncertain_is_failure:false',
]) {
  if (!visual188.includes(token)) throw new Error('visual-review-v188 missing ' + token);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const entry = String(pkg.main || '');
if (!entry) throw new Error('package.json has no Electron main entry');
if (!fs.existsSync(path.join(root, entry))) throw new Error('Current Electron main entry is missing: ' + entry);

if (entry !== 'main-v188.js') {
  const layeredEntry = fs.readFileSync(path.join(root, entry), 'utf8');
  if (!layeredEntry.includes("require('./main-v188.js')")) {
    throw new Error('Current Electron entry does not chain to the validated v1.8.8 base runtime: ' + entry);
  }
}

const buildFiles = Array.isArray(pkg?.build?.files) ? pkg.build.files.map(String) : [];
if (!buildFiles.some(x => x === 'main-v188.js' || x === 'main*.js' || x.includes('main-v188'))) {
  throw new Error('electron-builder files do not include main-v188.js base runtime');
}
if (!buildFiles.some(x => x === 'lib/**/*' || x.includes('lib/'))) {
  throw new Error('electron-builder files do not include lib runtime modules');
}

console.log(`Nexa AI v1.8.8 base-runtime validation: OK (active entry: ${entry}, package ${pkg.version})`);
