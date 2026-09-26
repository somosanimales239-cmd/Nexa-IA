'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const fromRoot = rel => path.join(root, rel);
const localRoot = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(localRoot, rel), 'utf8');

const pkg = JSON.parse(read('package.json'));
const project = JSON.parse(read('nexa.project.json'));
const bootstrap = read('main-v180.js');
const visual = require(path.join(localRoot, 'lib/visual-evaluator-v180.js'));

assert.equal(pkg.version, '1.8.0');
assert.equal(pkg.main, 'main-v180.js');
assert.equal(project.version, '1.8.0');
assert.equal(project.application_version, '1.8.0');
assert.ok(Array.isArray(pkg.build?.files) && pkg.build.files.includes('main-v180.js'));
assert.ok(pkg.build.files.includes('main.js'), 'legacy core main.js must stay packaged because v1.8 patches and runs it');

for (const marker of [
  'NEXA_VISUAL_PIPELINE_V180',
  'v180CallEvaluator',
  'V180.initialConstraints',
  'V180.applyRepairs',
  'V180.bestAttempt',
  'images:[imageBase64]',
  'format:V180.SCHEMA',
  "keep_alive:'0s'",
  'num_gpu:0',
  'visual-evaluator-v180.log',
  'Nexa Visual APROBÓ',
  'qwen_call_start',
  'qwen_review_complete',
]) assert.ok(bootstrap.includes(marker), `missing bootstrap marker: ${marker}`);

assert.equal(visual.MODEL, 'qwen2.5vl:3b');
assert.equal(visual.MAX_ATTEMPTS, 3);
assert.equal(visual.THRESHOLD, 86);
assert.equal(visual.SCHEMA.type, 'object');

const testPrompt = 'Crea un kanguro boxeador estilo cartoon, en pose dinámica, con guantes rojos, pero con encuadre muy cercano.';
const spec = visual.deriveVisualSpec(testPrompt);
assert.equal(spec.exact_subject_count, 1);
assert.equal(spec.requested_species, 'kangaroo');
assert.equal(spec.requested_style, 'cartoon');
assert.equal(spec.requested_framing, 'close');
assert.ok(spec.requested_attributes.includes('red boxing gloves'));
assert.equal(spec.requested_pose, 'dynamic boxing pose');

const constrained = visual.initialConstraints({
  positive_prompt:'cartoon boxer, character concept art, multiple poses',
  negative_prompt:'blurry',
  width:1024,
  height:768,
  steps:30,
  cfg:6,
}, testPrompt);
assert.equal(constrained.width, 896);
assert.equal(constrained.height, 896);
assert.match(constrained.positive_prompt, /exactly one main subject/i);
assert.match(constrained.positive_prompt, /long upright kangaroo ears/i);
assert.doesNotMatch(constrained.positive_prompt, /character concept art/i);
assert.doesNotMatch(constrained.positive_prompt, /multiple poses/i);
assert.match(constrained.negative_prompt, /character sheet/i);
assert.match(constrained.negative_prompt, /multiple views/i);
assert.match(constrained.negative_prompt, /bird beak/i);

const rejected = visual.finalizeEvaluation({
  subject_identity:'pass',
  subject_count:'fail',
  species_identity:'fail',
  requested_attributes:'pass',
  pose_action:'pass',
  style:'pass',
  framing:'pass',
  anatomy:'pass',
  background:'pass',
  text_integrity:'na',
  technical_quality:'pass',
  detected_subject_count:2,
  detected_subject:'anthropomorphic boxer characters',
  detected_species:'unclear animal',
  confidence:0.96,
  error_codes:[],
  problems:[],
  repair_positive:[],
  repair_negative:[],
}, testPrompt, 86);
assert.equal(rejected.pass, false);
assert.ok(rejected.error_codes.includes('E002'));
assert.ok(rejected.error_codes.includes('E003'));
assert.ok(rejected.error_codes.includes('E008'));

const repaired = visual.applyRepairs(constrained, rejected, testPrompt, 2);
assert.match(repaired.positive_prompt, /unmistakable kangaroo anatomy/i);
assert.match(repaired.positive_prompt, /large muscular balancing kangaroo tail/i);
assert.match(repaired.negative_prompt, /character sheet/i);
assert.match(repaired.negative_prompt, /wrong species/i);

const approved = visual.finalizeEvaluation({
  subject_identity:'pass',
  subject_count:'pass',
  species_identity:'pass',
  requested_attributes:'pass',
  pose_action:'pass',
  style:'pass',
  framing:'pass',
  anatomy:'pass',
  background:'pass',
  text_integrity:'na',
  technical_quality:'pass',
  detected_subject_count:1,
  detected_subject:'kangaroo boxer',
  detected_species:'kangaroo',
  confidence:0.98,
  error_codes:[],
  problems:[],
  repair_positive:[],
  repair_negative:[],
}, testPrompt, 86);
assert.equal(approved.pass, true);
assert.equal(approved.score, 100);

const chosen = visual.bestAttempt([
  { attempt:1, image:{path:'a.png'}, evaluation:rejected },
  { attempt:2, image:{path:'b.png'}, evaluation:approved },
]);
assert.equal(chosen.attempt, 2);

// If this runs after the update has been placed in the full Nexa workspace,
// validate that the old core still contains every anchor v1.8 patches.
const legacyPath = fromRoot('main.js');
if (fs.existsSync(legacyPath)) {
  const legacy = fs.readFileSync(legacyPath, 'utf8');
  const anchors = [
    "const APP_VERSION = '1.7.0';",
    'async function generateImage(event, payload) {',
    'async function stopImageGeneration(requestId) {',
    'async function releaseComfyResources(baseUrl)',
    'function requestJsonTracked(',
    'async function getComfyKSamplerOptions(',
    'async function copyComfyImageToNexa(',
    'const activeImageRequests = new Map()',
  ];
  for (const anchor of anchors) assert.ok(legacy.includes(anchor), `v1.8 legacy core anchor missing: ${anchor}`);
}

// App Builder conflict-marker guard. Do not use decorative separator lines in v1.8 files.
for (const rel of ['main-v180.js','lib/visual-evaluator-v180.js','package.json','nexa.project.json']) {
  const body = read(rel);
  const conflictStart = '<'.repeat(7);
  const conflictMiddle = '='.repeat(7);
  const conflictEnd = '>'.repeat(7);
  assert.ok(!body.includes(conflictStart) && !body.includes(conflictMiddle) && !body.includes(conflictEnd), `${rel} contains a conflict-like marker`);
}

console.log('Nexa AI v1.8.0 visual pipeline validation: OK');
