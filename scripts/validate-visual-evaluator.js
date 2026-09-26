'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_VISUAL_EVALUATOR_MODEL,
  VISUAL_EVALUATION_SCHEMA,
  scoreEvaluation,
  applyRepairs,
  bestAttempt,
} = require('../lib/visual-evaluator');

assert.equal(DEFAULT_VISUAL_EVALUATOR_MODEL, 'qwen2.5vl:3b');
assert.equal(VISUAL_EVALUATION_SCHEMA.type, 'object');
assert.ok(VISUAL_EVALUATION_SCHEMA.required.includes('error_codes'));

const good = scoreEvaluation({
  subject_identity:'pass', subject_count:'pass', species_identity:'pass', framing:'pass', style:'pass',
  requested_attributes:'pass', anatomy:'pass', background:'pass', text_integrity:'na', technical_quality:'pass',
  detected_subject_count:1, confidence:0.95, error_codes:[], problems:[], repair_positive:[], repair_negative:[],
}, 86);
assert.equal(good.pass, true);
assert.equal(good.score, 100);

const duplicate = scoreEvaluation({
  subject_identity:'pass', subject_count:'fail', species_identity:'pass', framing:'pass', style:'pass',
  requested_attributes:'pass', anatomy:'pass', background:'pass', text_integrity:'na', technical_quality:'pass',
  detected_subject_count:2, confidence:0.92, error_codes:['E003'], problems:['duplicate subject'], repair_positive:[], repair_negative:[],
}, 86);
assert.equal(duplicate.pass, false);
assert.equal(duplicate.critical, true);

const repaired = applyRepairs({ positive_prompt:'cartoon kangaroo boxer', negative_prompt:'blurry' }, duplicate, 2);
assert.match(repaired.positive_prompt, /single isolated subject/i);
assert.match(repaired.negative_prompt, /duplicate subject/i);

const best = bestAttempt([
  { attempt:1, image:{path:'a.png'}, evaluation:{score:70, pass:false} },
  { attempt:2, image:{path:'b.png'}, evaluation:{score:92, pass:true} },
  { attempt:3, image:{path:'c.png'}, evaluation:{score:80, pass:false} },
]);
assert.equal(best.attempt, 2);

// When run from the Nexa source root, verify the whole Build 106 wiring.
const root = process.cwd();
const mainPath = path.join(root, 'main.js');
if (fs.existsSync(mainPath)) {
  const main = fs.readFileSync(mainPath, 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const appJs = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
  assert.match(main, /NEXA_VISUAL_EVALUATOR_BUILD_106/);
  assert.match(main, /qwen2\.5vl:3b|DEFAULT_VISUAL_EVALUATOR_MODEL/);
  assert.match(main, /visual-evaluator:status/);
  assert.match(main, /visual-evaluator:install/);
  assert.match(main, /evaluateGeneratedImage/);
  assert.match(main, /applyVisualRepairs/);
  assert.match(main, /bestVisualAttempt/);
  assert.match(main, /keep_alive:'0s'/);
  assert.match(main, /options\.num_gpu = 0/);
  assert.match(preload, /visualEvaluator:/);
  assert.match(appJs, /refreshVisualEvaluatorStatus/);
  assert.match(appJs, /installVisualEvaluator/);
  assert.match(html, /Nexa Visual Evaluator v1/);
  assert.match(html, /settingVisualEvaluatorCpuOnly/);
}

console.log('Nexa Visual Evaluator v1 validation: OK');
