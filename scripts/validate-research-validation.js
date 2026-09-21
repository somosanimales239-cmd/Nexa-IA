'use strict';
const assert = require('assert');
const {
  parseResearchValidation,
  protocolInstructions,
  safePartialFromText,
} = require('../lib/research-validation');

const json = parseResearchValidation('{"verification_status":"VERIFIED","confidence":0.95,"system":"Engine Control","topic":"DTC P0302","summary":"Cylinder 2 misfire evidence.","content":{"facts":["Fact A"]},"source_indexes":[1,2]}');
assert(json);
assert.equal(json.verification_status, 'VERIFIED');
assert.equal(json.confidence, 0.95);
assert.deepEqual(json.source_indexes, [1,2]);

const fenced = parseResearchValidation('```json\n{"verification_status":"PARTIAL","confidence":0.7,"summary":"Partial evidence"}\n```');
assert(fenced);
assert.equal(fenced.verification_status, 'PARTIAL');

const tagged = parseResearchValidation([
  'NEXA_VALIDATION_V1',
  'STATUS: VERIFIED',
  'CONFIDENCE: 0.91',
  'SYSTEM: Ignition',
  'TOPIC: Spark Plug Specs',
  'SUMMARY: Verified from supplied evidence.',
  'DESCRIPTION: Plug specification evidence.',
  'FACTS:',
  '- Fact one',
  '- Fact two',
  'PROCEDURES:',
  '- Procedure one',
  'SPECIFICATIONS:',
  '- Gap 1.1 mm',
  'WARNINGS:',
  '- Confirm exact engine',
  'RELATED_TOPICS:',
  '- Ignition Coil Inspection',
  'APPLICABLE_YEARS: 2000',
  'ENGINE: 1ZZ-FE',
  'TRANSMISSION:',
  'MARKET: US',
  'SOURCE_INDEXES: 1, 3',
  'REASON: Exact engine and year appear in evidence.',
  'END_NEXA_VALIDATION',
].join('\n'));
assert(tagged);
assert.equal(tagged.parser, 'tagged');
assert.equal(tagged.verification_status, 'VERIFIED');
assert.equal(tagged.engine, '1ZZ-FE');
assert.deepEqual(tagged.source_indexes, [1,3]);
assert.equal(tagged.content.facts.length, 2);

const prefixed = parseResearchValidation('Here is the result:\n{"verification_status":"NOT VERIFIED","confidence":0.2,"summary":"Insufficient evidence"}');
assert(prefixed);
assert.equal(prefixed.verification_status, 'NOT VERIFIED');

const fallback = safePartialFromText('The supplied sources indicate potentially relevant information, but exact applicability still needs review.', { topic:'Fuel Pressure Inspection', system:'Fuel System' });
assert(fallback);
assert.equal(fallback.verification_status, 'PARTIAL');
assert.equal(fallback.confidence, 0.5);
assert.equal(fallback.topic, 'Fuel Pressure Inspection');

const protocol = protocolInstructions();
assert(protocol.includes('NEXA_VALIDATION_V1'));
assert(protocol.includes('SOURCE_INDEXES'));

console.log('Research validation compatibility: 6/6 PASS');
