'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PersistentKnowledgeDB, AUTOMOTIVE_BASE_TOPICS } = require('../lib/persistent-knowledge');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-knowledge-test-'));
let db;
try {
  db = new PersistentKnowledgeDB(root);
  const objective = db.createObjective({ type:'automotive', make:'Toyota', model:'Corolla', year:2021, engine_code:'M20A-FKS', engine_displacement:'2.0L', market:'US' });
  if (!objective || objective.type !== 'automotive') throw new Error('Automotive objective creation failed');
  const topics = db.listTopics(objective.id);
  if (topics.length !== AUTOMOTIVE_BASE_TOPICS.length) throw new Error(`Expected ${AUTOMOTIVE_BASE_TOPICS.length} base topics, got ${topics.length}`);
  if (!topics.every(t => t.status === 'MISSING')) throw new Error('New base topics must start MISSING');

  const first = db.saveKnowledge({
    objective_id:objective.id,
    system:'Engine Control', topic:'DTC P0302', summary:'Cylinder 2 misfire test knowledge.',
    content:{ description:'Cylinder 2 misfire test knowledge.', possible_causes:[], diagnostic_procedure:[] },
    confidence:0.95, verification_status:'VERIFIED',
    source:{ name:'OEM test', title:'OEM test source', url:'https://example.com/oem-test', source_type:'OEM', access_date:new Date().toISOString() },
  });
  if (!first.entry || first.duplicate) throw new Error('Persistent save failed');
  const duplicate = db.saveKnowledge({
    objective_id:objective.id,
    system:'Engine Control', topic:'DTC P0302', summary:'Cylinder 2 misfire test knowledge.',
    content:{ description:'Cylinder 2 misfire test knowledge.', possible_causes:[], diagnostic_procedure:[] },
    confidence:0.95, verification_status:'VERIFIED',
    source:{ name:'OEM test', title:'OEM test source', url:'https://example.com/oem-test', source_type:'OEM', access_date:new Date().toISOString() },
  });
  if (!duplicate.duplicate) throw new Error('Duplicate detection failed');

  const second = db.saveKnowledge({
    objective_id:objective.id,
    system:'Engine Control', topic:'DTC P0302', summary:'Updated cylinder 2 misfire verified knowledge.',
    content:{ description:'Updated cylinder 2 misfire verified knowledge.' },
    confidence:0.96, verification_status:'VERIFIED',
    source:{ name:'OEM test 2', title:'OEM updated source', url:'https://example.com/oem-test-2', source_type:'OEM', access_date:new Date().toISOString() },
  });
  if (Number(second.entry.version_no) !== 2) throw new Error('Knowledge version history failed');
  const found = db.search('P0302 Corolla M20A-FKS', { objectiveIds:[objective.id], limit:5 });
  if (!found.length || found[0].verification_status !== 'VERIFIED') throw new Error('Persistent search failed');
  const stats = db.stats();
  if (!fs.existsSync(stats.dbPath)) throw new Error('SQLite database file was not created');
  console.log('Persistent Knowledge DB validation: PASS');
  console.log(`Database: ${stats.dbPath}`);
  console.log(`Topics: ${topics.length}; active entries: ${stats.active_entries}; sources: ${stats.knowledge_sources}`);
} finally {
  if (db) db.close();
  try { fs.rmSync(root,{recursive:true,force:true}); } catch (_) {}
}
