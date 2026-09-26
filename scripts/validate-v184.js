'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const pkg = JSON.parse(read('package.json'));
const project = JSON.parse(read('nexa.project.json'));
const main = read('main-v184.js');
const visual = require(path.join(root, 'lib/visual-review-v184.js'));

assert.equal(pkg.version, '1.8.4');
assert.equal(pkg.main, 'main-v184.js');
assert.ok(pkg.build.files.includes('main-v184.js'));
assert.ok(pkg.build.files.includes('main.js'));
assert.equal(project.version, '1.8.4');

for (const marker of [
  'parseEvaluationJsonLenient',
  'repairEvaluationJsonWithQwen',
  'fallbackEvaluationFromText',
  'withHeartbeat',
  'visual-status-v184.json',
  'installRendererNoTimeout',
  'image:generate',
  'qwen2.5vl:3b',
  "require('./main.js')",
]) assert.ok(main.includes(marker), marker);

assert.ok(!main.includes('Qwen2.5-VL no devolvió JSON utilizable.'));
assert.ok(!main.includes('ComfyUI tardó demasiado durante retry.'));

const prompt = 'Crea una imagen kanguro boxeador estilo cartoon, en pose dinámica, con guantes rojos, pero con encuadre muy cercano.';
const spec = visual.deriveVisualSpec(prompt);
assert.equal(spec.exact_subject_count, 1);
assert.equal(spec.requested_species, 'kangaroo');
assert.equal(spec.requested_framing, 'close');
assert.deepEqual(visual.targetDimensions(prompt), { width: 896, height: 896 });

for (const rel of ['main-v184.js','lib/visual-review-v184.js','package.json','nexa.project.json']) {
  const body = read(rel);
  assert.ok(!body.includes('<<<<<<<'), rel + ' conflict marker');
  assert.ok(!body.includes('>>>>>>>'), rel + ' conflict marker');
}

console.log('Nexa AI v1.8.4 stable visual review validation: OK');
