'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const AUTOMOTIVE_BASE_TOPICS = [
  'Vehicle Identification','Engine','Engine Control','Fuel System','Ignition','Cooling System','Lubrication','Intake','Exhaust',
  'Transmission','Drivetrain','Electrical','Charging System','Starting System','Wiring Diagrams','Connector Pinouts','Brakes','ABS',
  'Steering','Suspension','Air Conditioning','Heating','Airbag / SRS','Body','Lighting','ADAS / Driver Assistance','Maintenance',
  'Fluids','Capacities','Torque Specifications','Diagnostic Trouble Codes','Technical Service Bulletins','Recalls','Repair Procedures',
  'Removal / Installation','Testing / Inspection','Specifications'
];

const VALID_STATUSES = new Set(['VERIFIED','PARTIAL','MISSING','CONFLICTING','OUTDATED','NOT VERIFIED']);

function nowIso() { return new Date().toISOString(); }
function makeId(prefix) { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`; }
function cleanText(value, max = 5000) { return String(value ?? '').trim().slice(0, max); }
function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_+#.-]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokens(value) {
  const stop = new Set('a al algo ante como con contra cual cuando de del desde donde el ella ellas ellos en entre es esa ese esta este esto la las le les lo los mas me mi no nos o para pero por porque que se sin sobre su sus te tiene tu tus un una uno unos y the an and are as at be by for from has have if in into is it its of on or that their then there these this to was were will with'.split(' '));
  return [...new Set(normalize(value).split(' ').filter(t => t.length > 1 && !stop.has(t)).slice(0, 32))];
}
function toJson(value) {
  if (typeof value === 'string') {
    try { JSON.parse(value); return value; } catch (_) { return JSON.stringify({ text: value }); }
  }
  return JSON.stringify(value ?? {});
}
function parseJson(value, fallback = {}) { try { return JSON.parse(value); } catch (_) { return fallback; } }

class PersistentKnowledgeDB {
  constructor(dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.path = path.join(dataDir, 'nexa-knowledge.db');
    this.db = new DatabaseSync(this.path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS knowledge_objectives (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'general',
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'General',
        description TEXT NOT NULL DEFAULT '',
        make TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', year INTEGER,
        generation TEXT NOT NULL DEFAULT '', trim TEXT NOT NULL DEFAULT '',
        engine_code TEXT NOT NULL DEFAULT '', engine_displacement TEXT NOT NULL DEFAULT '', fuel_type TEXT NOT NULL DEFAULT '',
        transmission TEXT NOT NULL DEFAULT '', drivetrain TEXT NOT NULL DEFAULT '', body_style TEXT NOT NULL DEFAULT '',
        market TEXT NOT NULL DEFAULT '', vin TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        auto_research INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS objective_topics (
        id TEXT PRIMARY KEY,
        objective_id TEXT NOT NULL REFERENCES knowledge_objectives(id) ON DELETE CASCADE,
        system TEXT NOT NULL DEFAULT '', subsystem TEXT NOT NULL DEFAULT '', topic TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'MISSING', priority INTEGER NOT NULL DEFAULT 100,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(objective_id, system, subsystem, topic)
      );
      CREATE TABLE IF NOT EXISTS knowledge_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', domain TEXT NOT NULL DEFAULT '',
        source_type TEXT NOT NULL DEFAULT 'Secondary', manufacturer TEXT NOT NULL DEFAULT '', document_number TEXT NOT NULL DEFAULT '',
        publication_date TEXT NOT NULL DEFAULT '', access_date TEXT NOT NULL DEFAULT '', page_section TEXT NOT NULL DEFAULT '',
        license_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
        UNIQUE(url, title)
      );
      CREATE TABLE IF NOT EXISTS knowledge_entries (
        id TEXT PRIMARY KEY,
        objective_id TEXT REFERENCES knowledge_objectives(id) ON DELETE SET NULL,
        topic_id TEXT REFERENCES objective_topics(id) ON DELETE SET NULL,
        system TEXT NOT NULL DEFAULT '', subsystem TEXT NOT NULL DEFAULT '', topic TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '', content_json TEXT NOT NULL DEFAULT '{}', searchable_text TEXT NOT NULL DEFAULT '',
        applicable_years TEXT NOT NULL DEFAULT '', engine TEXT NOT NULL DEFAULT '', transmission TEXT NOT NULL DEFAULT '', market TEXT NOT NULL DEFAULT '',
        confidence REAL NOT NULL DEFAULT 0.0, verification_status TEXT NOT NULL DEFAULT 'PARTIAL',
        content_hash TEXT NOT NULL, version_no INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1,
        primary_source_id TEXT REFERENCES knowledge_sources(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_entries_objective ON knowledge_entries(objective_id, active);
      CREATE INDEX IF NOT EXISTS idx_entries_topic ON knowledge_entries(topic, active);
      CREATE INDEX IF NOT EXISTS idx_entries_hash ON knowledge_entries(content_hash);
      CREATE TABLE IF NOT EXISTS knowledge_entry_sources (
        entry_id TEXT NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
        support_role TEXT NOT NULL DEFAULT 'supporting',
        PRIMARY KEY(entry_id, source_id)
      );
      CREATE TABLE IF NOT EXISTS knowledge_relations (
        id TEXT PRIMARY KEY,
        objective_id TEXT REFERENCES knowledge_objectives(id) ON DELETE CASCADE,
        from_entry_id TEXT REFERENCES knowledge_entries(id) ON DELETE CASCADE,
        to_entry_id TEXT REFERENCES knowledge_entries(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL DEFAULT 'related', created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS research_runs (
        id TEXT PRIMARY KEY,
        objective_id TEXT REFERENCES knowledge_objectives(id) ON DELETE SET NULL,
        topic TEXT NOT NULL DEFAULT '', query TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'RUNNING',
        source_count INTEGER NOT NULL DEFAULT 0, saved_entry_id TEXT REFERENCES knowledge_entries(id) ON DELETE SET NULL,
        notes TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, finished_at TEXT NOT NULL DEFAULT ''
      );
    `);
    const stmt = this.db.prepare('INSERT INTO knowledge_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    stmt.run('schema_version', '1');
  }

  close() { try { this.db.close(); } catch (_) {} }

  getObjective(id) {
    return this.db.prepare('SELECT * FROM knowledge_objectives WHERE id=?').get(String(id)) || null;
  }

  listObjectives() {
    const rows = this.db.prepare(`
      SELECT o.*,
        (SELECT COUNT(*) FROM objective_topics t WHERE t.objective_id=o.id) AS topic_count,
        (SELECT COUNT(*) FROM objective_topics t WHERE t.objective_id=o.id AND t.status='VERIFIED') AS verified_count,
        (SELECT COUNT(*) FROM objective_topics t WHERE t.objective_id=o.id AND t.status='PARTIAL') AS partial_count,
        (SELECT COUNT(*) FROM objective_topics t WHERE t.objective_id=o.id AND t.status='MISSING') AS missing_count,
        (SELECT COUNT(*) FROM objective_topics t WHERE t.objective_id=o.id AND t.status='CONFLICTING') AS conflicting_count,
        (SELECT COUNT(*) FROM knowledge_entries e WHERE e.objective_id=o.id AND e.active=1) AS entry_count
      FROM knowledge_objectives o ORDER BY o.updated_at DESC
    `).all();
    return rows.map(r => ({ ...r, enabled:Boolean(r.enabled), auto_research:Boolean(r.auto_research) }));
  }

  createObjective(input = {}) {
    const type = input.type === 'automotive' ? 'automotive' : 'general';
    const make = cleanText(input.make, 80);
    const model = cleanText(input.model, 100);
    const year = Number(input.year) || null;
    const engineCode = cleanText(input.engine_code || input.engineCode, 100);
    const displacement = cleanText(input.engine_displacement || input.engineDisplacement, 60);
    let name = cleanText(input.name, 160);
    if (!name && type === 'automotive') name = [make, model, year, engineCode || displacement].filter(Boolean).join(' ');
    if (!name) throw new Error('El objetivo necesita un nombre.');
    if (type === 'automotive' && (!make || !model || !year)) throw new Error('Para un objetivo automotriz necesitas fabricante, modelo y año.');
    const row = {
      id: makeId('obj'), type, name,
      category: cleanText(input.category || (type === 'automotive' ? 'Automotive' : 'General'), 80) || 'General',
      description: cleanText(input.description, 2000),
      make, model, year,
      generation: cleanText(input.generation, 80), trim: cleanText(input.trim, 100),
      engine_code: engineCode, engine_displacement: displacement, fuel_type: cleanText(input.fuel_type || input.fuelType, 60),
      transmission: cleanText(input.transmission, 120), drivetrain: cleanText(input.drivetrain, 80), body_style: cleanText(input.body_style || input.bodyStyle, 80),
      market: cleanText(input.market, 80), vin: cleanText(input.vin, 40),
      enabled: input.enabled === false ? 0 : 1, auto_research: input.auto_research === false ? 0 : 1,
      created_at: nowIso(), updated_at: nowIso(),
    };
    this.db.prepare(`INSERT INTO knowledge_objectives(
      id,type,name,category,description,make,model,year,generation,trim,engine_code,engine_displacement,fuel_type,transmission,drivetrain,body_style,market,vin,enabled,auto_research,created_at,updated_at
    ) VALUES(@id,@type,@name,@category,@description,@make,@model,@year,@generation,@trim,@engine_code,@engine_displacement,@fuel_type,@transmission,@drivetrain,@body_style,@market,@vin,@enabled,@auto_research,@created_at,@updated_at)`).run(row);
    const topics = type === 'automotive'
      ? AUTOMOTIVE_BASE_TOPICS
      : (Array.isArray(input.topics) && input.topics.length ? input.topics : ['General Knowledge']);
    for (const topic of topics) this.ensureTopic(row.id, topic, topic, '');
    return this.getObjective(row.id);
  }

  updateObjective(id, patch = {}) {
    const current = this.getObjective(id);
    if (!current) throw new Error('Objetivo no encontrado.');
    const allowed = ['name','category','description','generation','trim','engine_code','engine_displacement','fuel_type','transmission','drivetrain','body_style','market','vin'];
    const next = { ...current };
    for (const key of allowed) if (Object.prototype.hasOwnProperty.call(patch, key)) next[key] = cleanText(patch[key], key === 'description' ? 2000 : 160);
    if (Object.prototype.hasOwnProperty.call(patch,'enabled')) next.enabled = patch.enabled === false ? 0 : 1;
    if (Object.prototype.hasOwnProperty.call(patch,'auto_research')) next.auto_research = patch.auto_research === false ? 0 : 1;
    next.updated_at = nowIso();
    this.db.prepare(`UPDATE knowledge_objectives SET name=@name,category=@category,description=@description,generation=@generation,trim=@trim,
      engine_code=@engine_code,engine_displacement=@engine_displacement,fuel_type=@fuel_type,transmission=@transmission,drivetrain=@drivetrain,
      body_style=@body_style,market=@market,vin=@vin,enabled=@enabled,auto_research=@auto_research,updated_at=@updated_at WHERE id=@id`).run(next);
    return this.getObjective(id);
  }

  deleteObjective(id) {
    this.db.prepare('DELETE FROM knowledge_objectives WHERE id=?').run(String(id));
    return true;
  }

  ensureTopic(objectiveId, topic, system = '', subsystem = '') {
    const objective = this.getObjective(objectiveId);
    if (!objective) throw new Error('Objetivo no encontrado.');
    const cleanTopic = cleanText(topic, 180);
    const cleanSystem = cleanText(system, 120);
    const cleanSubsystem = cleanText(subsystem, 120);
    if (!cleanTopic) throw new Error('El tema no puede estar vacío.');
    const existing = this.db.prepare('SELECT * FROM objective_topics WHERE objective_id=? AND system=? AND subsystem=? AND topic=?')
      .get(objectiveId, cleanSystem, cleanSubsystem, cleanTopic);
    if (existing) return existing;
    const row = { id:makeId('topic'), objective_id:objectiveId, system:cleanSystem, subsystem:cleanSubsystem, topic:cleanTopic, status:'MISSING', priority:100, created_at:nowIso(), updated_at:nowIso() };
    this.db.prepare('INSERT INTO objective_topics(id,objective_id,system,subsystem,topic,status,priority,created_at,updated_at) VALUES(@id,@objective_id,@system,@subsystem,@topic,@status,@priority,@created_at,@updated_at)').run(row);
    return row;
  }

  listTopics(objectiveId, limit = 500) {
    return this.db.prepare('SELECT * FROM objective_topics WHERE objective_id=? ORDER BY priority DESC, topic LIMIT ?').all(String(objectiveId), Math.max(1, Math.min(1000, Number(limit)||500)));
  }

  missingTopics(objectiveId, limit = 5) {
    return this.db.prepare("SELECT * FROM objective_topics WHERE objective_id=? AND status IN ('MISSING','PARTIAL','OUTDATED','NOT VERIFIED') ORDER BY CASE status WHEN 'MISSING' THEN 0 WHEN 'OUTDATED' THEN 1 WHEN 'PARTIAL' THEN 2 ELSE 3 END, priority DESC, topic LIMIT ?")
      .all(String(objectiveId), Math.max(1, Math.min(50, Number(limit)||5)));
  }

  setTopicStatus(topicId, status) {
    const value = VALID_STATUSES.has(status) ? status : 'PARTIAL';
    this.db.prepare('UPDATE objective_topics SET status=?, updated_at=? WHERE id=?').run(value, nowIso(), String(topicId));
  }

  upsertSource(source = {}) {
    const url = cleanText(source.url, 2000);
    const title = cleanText(source.title || source.name, 500);
    const existing = this.db.prepare('SELECT * FROM knowledge_sources WHERE url=? AND title=?').get(url, title);
    if (existing) {
      this.db.prepare('UPDATE knowledge_sources SET access_date=?, source_type=?, page_section=?, license_note=? WHERE id=?')
        .run(cleanText(source.access_date || source.accessDate || nowIso(), 80), cleanText(source.source_type || source.sourceType || existing.source_type, 80), cleanText(source.page_section || source.pageSection || existing.page_section, 300), cleanText(source.license_note || source.licenseNote || existing.license_note, 500), existing.id);
      return this.db.prepare('SELECT * FROM knowledge_sources WHERE id=?').get(existing.id);
    }
    let domain = cleanText(source.domain, 255);
    if (!domain && url) { try { domain = new URL(url).hostname.toLowerCase(); } catch (_) {} }
    const row = {
      id:makeId('src'), name:cleanText(source.name || title, 300), title, url, domain,
      source_type:cleanText(source.source_type || source.sourceType || 'Secondary', 80), manufacturer:cleanText(source.manufacturer, 120),
      document_number:cleanText(source.document_number || source.documentNumber, 120), publication_date:cleanText(source.publication_date || source.publicationDate, 80),
      access_date:cleanText(source.access_date || source.accessDate || nowIso(), 80), page_section:cleanText(source.page_section || source.pageSection, 300),
      license_note:cleanText(source.license_note || source.licenseNote, 500), created_at:nowIso(),
    };
    this.db.prepare(`INSERT INTO knowledge_sources(id,name,title,url,domain,source_type,manufacturer,document_number,publication_date,access_date,page_section,license_note,created_at)
      VALUES(@id,@name,@title,@url,@domain,@source_type,@manufacturer,@document_number,@publication_date,@access_date,@page_section,@license_note,@created_at)`).run(row);
    return row;
  }

  saveKnowledge(input = {}) {
    const objectiveId = input.objective_id || input.objectiveId || null;
    const objective = objectiveId ? this.getObjective(objectiveId) : null;
    if (objectiveId && !objective) throw new Error('Objetivo no encontrado.');
    const system = cleanText(input.system, 120);
    const subsystem = cleanText(input.subsystem, 120);
    const topic = cleanText(input.topic, 180);
    const summary = cleanText(input.summary || input.content?.description || input.content?.text || '', 8000);
    if (!topic || !summary) throw new Error('El conocimiento necesita topic y contenido.');
    let status = cleanText(input.verification_status || input.verificationStatus || 'PARTIAL', 40).toUpperCase();
    if (!VALID_STATUSES.has(status)) status = 'PARTIAL';
    const confidence = Math.max(0, Math.min(1, Number(input.confidence) || 0));
    const contentJson = toJson(input.content || { text: summary });
    const sourceInputs = Array.isArray(input.sources) ? input.sources : (input.source ? [input.source] : []);
    const sourceRows = sourceInputs.map(s => this.upsertSource(s));
    const primary = sourceRows[0] || null;
    const topicRow = objectiveId ? this.ensureTopic(objectiveId, topic, system, subsystem) : null;
    const hash = crypto.createHash('sha256').update([objectiveId||'', system, subsystem, topic, summary, contentJson, primary?.url || ''].join('\n')).digest('hex');
    const duplicate = this.db.prepare('SELECT * FROM knowledge_entries WHERE content_hash=? LIMIT 1').get(hash);
    if (duplicate) {
      if (topicRow) this.setTopicStatus(topicRow.id, status);
      return { entry:duplicate, duplicate:true, dbPath:this.path };
    }
    const previous = this.db.prepare(`SELECT * FROM knowledge_entries WHERE active=1 AND COALESCE(objective_id,'')=? AND system=? AND subsystem=? AND topic=? ORDER BY version_no DESC LIMIT 1`)
      .get(objectiveId || '', system, subsystem, topic);
    const versionNo = previous ? Number(previous.version_no || 1) + 1 : 1;
    if (previous) this.db.prepare('UPDATE knowledge_entries SET active=0, updated_at=? WHERE id=?').run(nowIso(), previous.id);
    const searchable = normalize([objective?.name, objective?.make, objective?.model, objective?.year, objective?.engine_code, system, subsystem, topic, summary, contentJson, sourceRows.map(s=>s.title+' '+s.url).join(' ')].filter(Boolean).join(' '));
    const row = {
      id:makeId('know'), objective_id:objectiveId, topic_id:topicRow?.id || null, system, subsystem, topic, summary, content_json:contentJson, searchable_text:searchable,
      applicable_years:cleanText(input.applicable_years || input.applicableYears || (objective?.year ? String(objective.year) : ''), 160),
      engine:cleanText(input.engine || objective?.engine_code || '', 120), transmission:cleanText(input.transmission || objective?.transmission || '', 160),
      market:cleanText(input.market || objective?.market || '', 100), confidence, verification_status:status, content_hash:hash,
      version_no:versionNo, active:1, primary_source_id:primary?.id || null, created_at:nowIso(), updated_at:nowIso(),
    };
    this.db.prepare(`INSERT INTO knowledge_entries(id,objective_id,topic_id,system,subsystem,topic,summary,content_json,searchable_text,applicable_years,engine,transmission,market,confidence,verification_status,content_hash,version_no,active,primary_source_id,created_at,updated_at)
      VALUES(@id,@objective_id,@topic_id,@system,@subsystem,@topic,@summary,@content_json,@searchable_text,@applicable_years,@engine,@transmission,@market,@confidence,@verification_status,@content_hash,@version_no,@active,@primary_source_id,@created_at,@updated_at)`).run(row);
    for (let i=0;i<sourceRows.length;i+=1) this.db.prepare('INSERT OR IGNORE INTO knowledge_entry_sources(entry_id,source_id,support_role) VALUES(?,?,?)').run(row.id, sourceRows[i].id, i===0?'primary':'supporting');
    if (topicRow) this.setTopicStatus(topicRow.id, status);
    if (objectiveId) this.db.prepare('UPDATE knowledge_objectives SET updated_at=? WHERE id=?').run(nowIso(), objectiveId);
    return { entry:row, duplicate:false, dbPath:this.path };
  }

  entrySources(entryId) {
    return this.db.prepare(`SELECT s.*, l.support_role FROM knowledge_sources s JOIN knowledge_entry_sources l ON l.source_id=s.id WHERE l.entry_id=? ORDER BY CASE l.support_role WHEN 'primary' THEN 0 ELSE 1 END, s.id`).all(String(entryId));
  }

  search(query, { objectiveIds = [], limit = 8, minConfidence = 0 } = {}) {
    const qTokens = tokens(query);
    if (!qTokens.length) return [];
    let sql = `SELECT e.*, o.name AS objective_name, o.type AS objective_type, o.make, o.model, o.year, o.engine_code,
      s.name AS source_name, s.title AS source_title, s.url AS source_url, s.source_type, s.page_section
      FROM knowledge_entries e LEFT JOIN knowledge_objectives o ON o.id=e.objective_id LEFT JOIN knowledge_sources s ON s.id=e.primary_source_id
      WHERE e.active=1 AND e.confidence>=?`;
    const args = [Number(minConfidence)||0];
    if (Array.isArray(objectiveIds) && objectiveIds.length) {
      sql += ` AND e.objective_id IN (${objectiveIds.map(()=>'?').join(',')})`;
      args.push(...objectiveIds.map(String));
    }
    sql += ' ORDER BY e.updated_at DESC LIMIT 2000';
    const rows = this.db.prepare(sql).all(...args);
    const normalizedQuery = normalize(query);
    const scored = [];
    for (const row of rows) {
      const text = row.searchable_text || normalize([row.topic,row.summary,row.objective_name,row.source_title].join(' '));
      let score = 0;
      if (normalizedQuery.length > 5 && text.includes(normalizedQuery)) score += 20;
      for (const token of qTokens) {
        if (normalize(row.topic).includes(token)) score += 6;
        if (normalize(row.objective_name).includes(token)) score += 4;
        let idx=-1,hits=0; while ((idx=text.indexOf(token,idx+1))>=0 && hits<8) hits++;
        if (hits) score += 1.5 + Math.min(8,hits)*1.05;
      }
      score += Math.max(0, Math.min(1, Number(row.confidence)||0))*3;
      if (row.verification_status === 'VERIFIED') score += 2;
      if (score > 2) scored.push({ score, row });
    }
    scored.sort((a,b)=>b.score-a.score);
    return scored.slice(0, Math.max(1, Math.min(50, Number(limit)||8))).map(item => ({
      ...item.row,
      score:Number(item.score.toFixed(2)),
      content:parseJson(item.row.content_json, { text:item.row.summary }),
      sources:this.entrySources(item.row.id),
    }));
  }

  createResearchRun(objectiveId, topic, query) {
    const row = { id:makeId('research'), objective_id:objectiveId || null, topic:cleanText(topic,180), query:cleanText(query,2000), status:'RUNNING', source_count:0, saved_entry_id:null, notes:'', started_at:nowIso(), finished_at:'' };
    this.db.prepare('INSERT INTO research_runs(id,objective_id,topic,query,status,source_count,saved_entry_id,notes,started_at,finished_at) VALUES(@id,@objective_id,@topic,@query,@status,@source_count,@saved_entry_id,@notes,@started_at,@finished_at)').run(row);
    return row;
  }

  finishResearchRun(runId, patch = {}) {
    this.db.prepare('UPDATE research_runs SET status=?,source_count=?,saved_entry_id=?,notes=?,finished_at=? WHERE id=?')
      .run(cleanText(patch.status || 'DONE',40), Number(patch.source_count)||0, patch.saved_entry_id || null, cleanText(patch.notes,2000), nowIso(), String(runId));
  }

  stats() {
    const counts = {};
    for (const table of ['knowledge_objectives','objective_topics','knowledge_entries','knowledge_sources','research_runs']) {
      counts[table] = Number(this.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c || 0);
    }
    counts.active_entries = Number(this.db.prepare('SELECT COUNT(*) AS c FROM knowledge_entries WHERE active=1').get().c || 0);
    counts.verified_entries = Number(this.db.prepare("SELECT COUNT(*) AS c FROM knowledge_entries WHERE active=1 AND verification_status='VERIFIED'").get().c || 0);
    return { dbPath:this.path, ...counts };
  }
}

module.exports = { PersistentKnowledgeDB, AUTOMOTIVE_BASE_TOPICS, VALID_STATUSES };
