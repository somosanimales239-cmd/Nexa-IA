'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { meaningfulValue, objectiveScope, assessApplicability, fallbackKnowledgeFromEvidence } = require('../lib/research-applicability');
const { PersistentKnowledgeDB } = require('../lib/persistent-knowledge');
const { buildResearchQuery } = require('../lib/web-research');

const objective = {
  type:'automotive', name:'Toyota Corolla 2000 1.8L 1ZZ-FE - US',
  make:'Toyota', model:'Corolla', year:2000, engine_code:'1ZZ-FE', engine_displacement:'1.8L',
  transmission:'MULTIPLE / TO BE IDENTIFIED', market:'US', generation:'', trim:'VE / CE / LE',
};

const manualText = '2000 Corolla(U) Engine Model: 1ZZ-FE Type: 4 cylinder in line, 4 cycle, gasoline. Displacement 1794 cm3. Service specifications ENGINE. Spark plug type DENSO SK16R11 NGK IFR5A11. Spark plug gap 1.1 mm.';
const source1 = { title:'Toyota 2000 Corolla Owner Manual', url:'https://example.com/manual', domain:'example.com', sourceType:'Technical', text:manualText, snippet:'2000 Corolla 1ZZ-FE engine service specifications' };
const source2 = { title:'2000 Toyota Corolla service information', url:'https://example.org/service', domain:'example.org', sourceType:'Technical', text:'Toyota Corolla 2000 CE LE VE 1.8L L4 VIN R 1ZZ-FE gasoline. Engine specifications and repair information.', snippet:'' };
const oem = { title:'Toyota Corolla 2000 technical data', url:'https://toyota.com/example', domain:'toyota.com', sourceType:'OEM', text:manualText, snippet:'' };

assert.strictEqual(meaningfulValue('MULTIPLE / TO BE IDENTIFIED'), '');
assert.strictEqual(meaningfulValue('1ZZ-FE'), '1ZZ-FE');
const engineScope = objectiveScope(objective, 'Engine');
assert.strictEqual(engineScope.required.engine, true);
assert.strictEqual(engineScope.required.transmission, false);
assert.strictEqual(engineScope.transmission, '');
const transScope = objectiveScope(objective, 'Transmission');
assert.strictEqual(transScope.transmission, '');
assert.strictEqual(transScope.required.transmission, false);
const query = buildResearchQuery(objective, 'Engine');
assert.ok(!query.toLowerCase().includes('to be identified'));
assert.ok(!query.toLowerCase().includes('multiple'));

const oneTech = assessApplicability(objective, 'Engine', [source1]);
assert.strictEqual(oneTech.recommendedStatus, 'PARTIAL');
assert.ok(oneTech.confidence >= 0.5);
assert.ok(oneTech.evidence.length > 0);
const fallback1 = fallbackKnowledgeFromEvidence(objective, 'Engine', [source1], oneTech);
assert.ok(fallback1);
assert.strictEqual(fallback1.verification_status, 'PARTIAL');
assert.ok(fallback1.summary.includes('1ZZ-FE'));

const twoTech = assessApplicability(objective, 'Engine', [source1, source2]);
assert.strictEqual(twoTech.recommendedStatus, 'PARTIAL');
assert.ok(twoTech.confidence >= 0.7);

const trusted = assessApplicability(objective, 'Engine', [oem]);
assert.strictEqual(trusted.recommendedStatus, 'VERIFIED');
assert.ok(trusted.confidence >= 0.9);

const transmissionSource = {...oem, text:'2000 Toyota Corolla transmission options include automatic transmission and manual transmission. Engine 1ZZ-FE.'};
const transmissionUnknown = assessApplicability(objective, 'Transmission', [transmissionSource]);
assert.strictEqual(transmissionUnknown.recommendedStatus, 'PARTIAL');
assert.strictEqual(transmissionUnknown.unresolvedRelevantField, true);

const wrongYear = assessApplicability(objective, 'Engine', [{...source1, text:'2001 Toyota Corolla 1ZZ-FE engine', title:'2001 Toyota Corolla', snippet:''}]);
assert.strictEqual(wrongYear.recommendedStatus, 'NOT VERIFIED');

// Migration + persistence: research evidence must survive even without an active knowledge entry.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa140-'));
const db = new PersistentKnowledgeDB(dir);
const created = db.createObjective(objective);
const topics = db.missingTopics(created.id, 3).map(row => row.topic);
assert.deepStrictEqual(topics, ['Vehicle Identification','Engine','Engine Control']);
const run = db.createResearchRun(created.id, 'Engine', 'Toyota Corolla 2000 1ZZ-FE Engine');
const ev = db.saveResearchEvidence({run_id:run.id, objective_id:created.id, topic:'Engine', query:'q', verification_status:'PARTIAL', confidence:0.64, sources:[source1]});
assert.ok(ev.id);
assert.strictEqual(db.stats().saved_evidence, 1);
const saved = db.saveKnowledge({objective_id:created.id, system:'Engine', topic:'Engine', summary:fallback1.summary, content:fallback1.content, confidence:fallback1.confidence, verification_status:fallback1.verification_status, sources:[{name:source1.title,title:source1.title,url:source1.url,source_type:source1.sourceType}]});
assert.ok(saved.entry.id);
const refreshed = db.listObjectives().find(row => row.id === created.id);
assert.strictEqual(Number(refreshed.partial_count), 1);
assert.strictEqual(Number(refreshed.entry_count), 1);
db.close();
fs.rmSync(dir,{recursive:true,force:true});

console.log('Research applicability + persistence validation: 22/22 PASS');
