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
      CREATE TABLE IF NOT EXISTS research_evidence (
        id TEXT PRIMARY KEY,
        run_id TEXT REFERENCES research_runs(id) ON DELETE SET NULL,
        objective_id TEXT REFERENCES knowledge_objectives(id) ON DELETE CASCADE,
        topic TEXT NOT NULL DEFAULT '', query TEXT NOT NULL DEFAULT '',
        verification_status TEXT NOT NULL DEFAULT 'NOT VERIFIED', confidence REAL NOT NULL DEFAULT 0.0,
        validator_reason TEXT NOT NULL DEFAULT '', applicability_json TEXT NOT NULL DEFAULT '{}', sources_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_research_evidence_objective ON research_evidence(objective_id, created_at);
      CREATE TABLE IF NOT EXISTS browser_captures (
        id TEXT PRIMARY KEY,
        objective_id TEXT REFERENCES knowledge_objectives(id) ON DELETE SET NULL,
        capture_type TEXT NOT NULL DEFAULT 'page',
        url TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', domain TEXT NOT NULL DEFAULT '',
        text_content TEXT NOT NULL DEFAULT '', selected_text TEXT NOT NULL DEFAULT '', metadata_json TEXT NOT NULL DEFAULT '{}',
        content_hash TEXT NOT NULL UNIQUE, source_id TEXT REFERENCES knowledge_sources(id) ON DELETE SET NULL,
        knowledge_entry_id TEXT REFERENCES knowledge_entries(id) ON DELETE SET NULL,
        verification_status TEXT NOT NULL DEFAULT 'PARTIAL', confidence REAL NOT NULL DEFAULT 0.55,
        capture_count INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_browser_captures_objective ON browser_captures(objective_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_browser_captures_url ON browser_captures(url, updated_at);
      CREATE TABLE IF NOT EXISTS browser_commands (
        id TEXT PRIMARY KEY, command_type TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'PENDING', result_json TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_browser_commands_status ON browser_commands(status, created_at);
      CREATE TABLE IF NOT EXISTS knowledge_factory_curricula (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, make TEXT NOT NULL, model TEXT NOT NULL,
        start_year INTEGER NOT NULL, end_year INTEGER NOT NULL, market TEXT NOT NULL DEFAULT 'US',
        completion_threshold REAL NOT NULL DEFAULT 0.85, status TEXT NOT NULL DEFAULT 'PAUSED',
        auto_continue INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS knowledge_factory_years (
        id TEXT PRIMARY KEY, curriculum_id TEXT NOT NULL REFERENCES knowledge_factory_curricula(id) ON DELETE CASCADE,
        make TEXT NOT NULL, model TEXT NOT NULL, year INTEGER NOT NULL, market TEXT NOT NULL DEFAULT 'US',
        discovery_status TEXT NOT NULL DEFAULT 'QUEUED', research_status TEXT NOT NULL DEFAULT 'QUEUED',
        coverage REAL NOT NULL DEFAULT 0.0, variant_count INTEGER NOT NULL DEFAULT 0,
        completed_configs INTEGER NOT NULL DEFAULT 0, total_configs INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(curriculum_id, year)
      );
      CREATE INDEX IF NOT EXISTS idx_factory_years_state ON knowledge_factory_years(curriculum_id, year, discovery_status, research_status);
      CREATE TABLE IF NOT EXISTS knowledge_factory_configs (
        id TEXT PRIMARY KEY, curriculum_id TEXT NOT NULL REFERENCES knowledge_factory_curricula(id) ON DELETE CASCADE,
        year_id TEXT NOT NULL REFERENCES knowledge_factory_years(id) ON DELETE CASCADE,
        make TEXT NOT NULL, model TEXT NOT NULL, year INTEGER NOT NULL, market TEXT NOT NULL DEFAULT 'US',
        generation TEXT NOT NULL DEFAULT '', body_style TEXT NOT NULL DEFAULT '', trims_json TEXT NOT NULL DEFAULT '[]',
        engine_code TEXT NOT NULL DEFAULT '', engine_displacement TEXT NOT NULL DEFAULT '', fuel_type TEXT NOT NULL DEFAULT '',
        transmission TEXT NOT NULL DEFAULT '', drivetrain TEXT NOT NULL DEFAULT '', technical_key TEXT NOT NULL,
        objective_id TEXT REFERENCES knowledge_objectives(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'QUEUED', coverage REAL NOT NULL DEFAULT 0.0, confidence REAL NOT NULL DEFAULT 0.0,
        verified_count INTEGER NOT NULL DEFAULT 0, partial_count INTEGER NOT NULL DEFAULT 0,
        missing_count INTEGER NOT NULL DEFAULT 0, conflicting_count INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '', sources_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(curriculum_id, technical_key)
      );
      CREATE INDEX IF NOT EXISTS idx_factory_configs_state ON knowledge_factory_configs(curriculum_id, year, status, coverage);
    `);
    const stmt = this.db.prepare('INSERT INTO knowledge_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    stmt.run('schema_version', '4');

    // Preserve the intended topic order for existing and new automotive objectives.
    // Earlier builds assigned the same priority to every topic, which made research run alphabetically.
    const priorityStmt = this.db.prepare('UPDATE objective_topics SET priority=? WHERE topic=?');
    for (let i=0;i<AUTOMOTIVE_BASE_TOPICS.length;i+=1) {
      priorityStmt.run(1000 - i, AUTOMOTIVE_BASE_TOPICS[i]);
    }
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
    const baseIndex = AUTOMOTIVE_BASE_TOPICS.indexOf(cleanTopic);
    const priority = baseIndex >= 0 ? (1000 - baseIndex) : 100;
    const row = { id:makeId('topic'), objective_id:objectiveId, system:cleanSystem, subsystem:cleanSubsystem, topic:cleanTopic, status:'MISSING', priority, created_at:nowIso(), updated_at:nowIso() };
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
    sql += ' ORDER BY e.updated_at DESC LIMIT 2500';
    const rows = this.db.prepare(sql).all(...args);
    const normalizedQuery = normalize(query);
    const yearMatches = String(query || '').match(/\b(?:19|20)\d{2}\b/g) || [];
    const queryYears = new Set(yearMatches.map(Number));
    const scored = [];
    for (const row of rows) {
      const content = parseJson(row.content_json, { text:row.summary });
      const metadata = content && typeof content.metadata === 'object' ? content.metadata : {};
      const metaYear = Number(metadata.year || 0) || null;
      if (queryYears.size && metaYear && !queryYears.has(metaYear)) continue;

      const text = row.searchable_text || normalize([row.topic,row.summary,row.objective_name,row.source_title].join(' '));
      let score = 0;
      if (normalizedQuery.length > 5 && text.includes(normalizedQuery)) score += 20;
      for (const token of qTokens) {
        if (normalize(row.topic).includes(token)) score += 6;
        if (normalize(row.system).includes(token)) score += 4;
        if (normalize(row.subsystem).includes(token)) score += 3;
        if (normalize(row.objective_name).includes(token)) score += 4;
        let idx=-1,hits=0; while ((idx=text.indexOf(token,idx+1))>=0 && hits<8) hits++;
        if (hits) score += 1.5 + Math.min(8,hits)*1.05;
      }

      const metaMake = normalize(metadata.make || row.make || '');
      const metaModel = normalize(metadata.model || row.model || '');
      const metaCategory = normalize(metadata.category_label || metadata.category || '');
      if (metaMake && normalizedQuery.includes(metaMake)) score += 10;
      if (metaModel && normalizedQuery.includes(metaModel)) score += 14;
      if (metaYear && queryYears.has(metaYear)) score += 12;
      if (metaCategory) {
        const categoryTokens = tokens(metaCategory);
        const categoryHits = categoryTokens.filter(token => qTokens.includes(token)).length;
        score += Math.min(10, categoryHits * 2.5);
      }
      if (metadata.strict_vehicle_match === true) score += 3;
      if (String(metadata.provider || '').toLowerCase().includes('google ai')) score += 1.5;
      score += Math.max(0, Math.min(1, Number(row.confidence)||0))*3;
      if (row.verification_status === 'VERIFIED') score += 3;
      else if (row.verification_status === 'PARTIAL') score += 0.5;
      if (score > 2) scored.push({ score, row, content, metadata });
    }
    scored.sort((a,b)=>b.score-a.score);
    return scored.slice(0, Math.max(1, Math.min(50, Number(limit)||8))).map(item => ({
      ...item.row,
      score:Number(item.score.toFixed(2)),
      content:item.content,
      retrieval_metadata:item.metadata,
      sources:this.entrySources(item.row.id),
    }));
  }

  saveResearchEvidence(input = {}) {
    const row = {
      id:makeId('evidence'), run_id:input.run_id || input.runId || null, objective_id:input.objective_id || input.objectiveId || null,
      topic:cleanText(input.topic,180), query:cleanText(input.query,2000),
      verification_status:cleanText(input.verification_status || input.verificationStatus || 'NOT VERIFIED',40).toUpperCase(),
      confidence:Math.max(0,Math.min(1,Number(input.confidence)||0)), validator_reason:cleanText(input.validator_reason || input.validatorReason,4000),
      applicability_json:toJson(input.applicability || {}), sources_json:toJson(Array.isArray(input.sources) ? input.sources : []), created_at:nowIso(),
    };
    this.db.prepare(`INSERT INTO research_evidence(id,run_id,objective_id,topic,query,verification_status,confidence,validator_reason,applicability_json,sources_json,created_at)
      VALUES(@id,@run_id,@objective_id,@topic,@query,@verification_status,@confidence,@validator_reason,@applicability_json,@sources_json,@created_at)`).run(row);
    return row;
  }

  recentResearchEvidence(objectiveId, limit = 20) {
    return this.db.prepare('SELECT * FROM research_evidence WHERE objective_id=? ORDER BY created_at DESC LIMIT ?')
      .all(String(objectiveId), Math.max(1,Math.min(100,Number(limit)||20)))
      .map(row => ({ ...row, applicability:parseJson(row.applicability_json,{}), sources:parseJson(row.sources_json,[]) }));
  }

  saveBrowserCapture(input = {}) {
    const objectiveId = input.objective_id || input.objectiveId || null;
    if (objectiveId && !this.getObjective(objectiveId)) throw new Error('Objetivo persistente no encontrado.');
    const captureType = cleanText(input.capture_type || input.captureType || 'page', 40) || 'page';
    const url = cleanText(input.url, 4000);
    const title = cleanText(input.title || input.topic || 'Browser Capture', 500) || 'Browser Capture';
    const selectedText = cleanText(input.selected_text || input.selectedText, 200000);
    const textContent = cleanText(input.text || input.text_content || input.textContent, 200000);
    const payloadText = selectedText || textContent;
    if (!payloadText) throw new Error('No hay texto para guardar desde el navegador.');
    let domain = '';
    try { domain = url ? new URL(url).hostname.toLowerCase() : ''; } catch (_) {}
    const source = this.upsertSource({
      name:title, title, url, domain, source_type:'Browser Extension',
      access_date:input.access_date || input.accessDate || nowIso(),
      page_section:captureType === 'selection' ? 'User selection' : 'Captured page',
      license_note:'Captured locally by the user through Nexa AI Browser Bridge. Respect source copyright and license.',
    });
    const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
    const contentHash = crypto.createHash('sha256').update([url, captureType, payloadText].join('\n')).digest('hex');
    const existing = this.db.prepare('SELECT * FROM browser_captures WHERE content_hash=? LIMIT 1').get(contentHash);
    if (existing) {
      this.db.prepare('UPDATE browser_captures SET capture_count=capture_count+1,updated_at=? WHERE id=?').run(nowIso(), existing.id);
      return { capture:this.db.prepare('SELECT * FROM browser_captures WHERE id=?').get(existing.id), knowledgeEntry:existing.knowledge_entry_id ? this.db.prepare('SELECT * FROM knowledge_entries WHERE id=?').get(existing.knowledge_entry_id) : null, duplicate:true, dbPath:this.path };
    }
    let verificationStatus = cleanText(input.verification_status || input.verificationStatus || 'PARTIAL', 40).toUpperCase();
    if (!VALID_STATUSES.has(verificationStatus) || verificationStatus === 'MISSING') verificationStatus = 'PARTIAL';
    const confidence = Math.max(0, Math.min(1, Number(input.confidence ?? 0.55) || 0.55));
    const row = {
      id:makeId('capture'), objective_id:objectiveId, capture_type:captureType, url, title, domain,
      text_content:textContent, selected_text:selectedText, metadata_json:toJson(metadata), content_hash:contentHash,
      source_id:source.id, knowledge_entry_id:null, verification_status:verificationStatus, confidence,
      capture_count:1, created_at:nowIso(), updated_at:nowIso(),
    };
    this.db.prepare(`INSERT INTO browser_captures(id,objective_id,capture_type,url,title,domain,text_content,selected_text,metadata_json,content_hash,source_id,knowledge_entry_id,verification_status,confidence,capture_count,created_at,updated_at)
      VALUES(@id,@objective_id,@capture_type,@url,@title,@domain,@text_content,@selected_text,@metadata_json,@content_hash,@source_id,@knowledge_entry_id,@verification_status,@confidence,@capture_count,@created_at,@updated_at)`).run(row);

    let knowledgeEntry = null;
    if (input.save_to_knowledge !== false && input.saveToKnowledge !== false) {
      const topic = cleanText(input.topic || title, 180) || 'Browser Capture';
      const system = cleanText(input.system || 'Browser Knowledge', 120) || 'Browser Knowledge';
      const summary = cleanText(input.summary || payloadText, 8000);
      const saved = this.saveKnowledge({
        objective_id:objectiveId,
        system,
        subsystem:cleanText(input.subsystem,120),
        topic,
        summary,
        content:{
          text:payloadText,
          captured_page_text:textContent,
          selected_text:selectedText,
          url, title, domain, capture_type:captureType,
          metadata,
          captured_at:row.created_at,
          source_origin:'Nexa AI Browser Bridge',
        },
        confidence,
        verification_status:verificationStatus,
        source:{ title, name:title, url, domain, source_type:'Browser Extension', access_date:row.created_at, page_section:captureType === 'selection' ? 'User selection' : 'Captured page' },
      });
      knowledgeEntry = saved.entry || null;
      row.knowledge_entry_id = knowledgeEntry?.id || null;
      this.db.prepare('UPDATE browser_captures SET knowledge_entry_id=?,updated_at=? WHERE id=?').run(row.knowledge_entry_id, nowIso(), row.id);
    }
    return { capture:{ ...row, metadata }, knowledgeEntry, duplicate:false, dbPath:this.path };
  }

  listBrowserCaptures(limit = 20) {
    return this.db.prepare(`SELECT c.*, o.name AS objective_name, s.source_type, s.title AS source_title
      FROM browser_captures c LEFT JOIN knowledge_objectives o ON o.id=c.objective_id LEFT JOIN knowledge_sources s ON s.id=c.source_id
      ORDER BY c.updated_at DESC LIMIT ?`).all(Math.max(1,Math.min(100,Number(limit)||20))).map(row => ({ ...row, metadata:parseJson(row.metadata_json,{}) }));
  }

  enqueueBrowserCommand(commandType, payload = {}) {
    const row = { id:makeId('browsercmd'), command_type:cleanText(commandType,80), payload_json:toJson(payload), status:'PENDING', result_json:'{}', error:'', created_at:nowIso(), updated_at:nowIso() };
    if (!row.command_type) throw new Error('Browser command type is required.');
    this.db.prepare('INSERT INTO browser_commands(id,command_type,payload_json,status,result_json,error,created_at,updated_at) VALUES(@id,@command_type,@payload_json,@status,@result_json,@error,@created_at,@updated_at)').run(row);
    return { ...row, payload:parseJson(row.payload_json,{}) };
  }

  claimNextBrowserCommand() {
    const row = this.db.prepare("SELECT * FROM browser_commands WHERE status='PENDING' ORDER BY created_at ASC LIMIT 1").get();
    if (!row) return null;
    this.db.prepare("UPDATE browser_commands SET status='CLAIMED',updated_at=? WHERE id=? AND status='PENDING'").run(nowIso(), row.id);
    const current = this.db.prepare('SELECT * FROM browser_commands WHERE id=?').get(row.id);
    return current ? { ...current, payload:parseJson(current.payload_json,{}) } : null;
  }

  getBrowserCommand(commandId) {
    const row = this.db.prepare('SELECT * FROM browser_commands WHERE id=?').get(String(commandId));
    return row ? { ...row, payload:parseJson(row.payload_json,{}), result:parseJson(row.result_json,{}) } : null;
  }

  completeBrowserCommand(commandId, input = {}) {
    const id = cleanText(commandId,160);
    if (!id) throw new Error('Browser command id is required.');
    const status = input.ok === false ? 'ERROR' : 'DONE';
    this.db.prepare('UPDATE browser_commands SET status=?,result_json=?,error=?,updated_at=? WHERE id=?')
      .run(status, toJson(input.result || {}), cleanText(input.error,2000), nowIso(), id);
    const row = this.db.prepare('SELECT * FROM browser_commands WHERE id=?').get(id);
    return row ? { ...row, payload:parseJson(row.payload_json,{}), result:parseJson(row.result_json,{}) } : null;
  }

  findMatchingAutomotiveObjective(input = {}) {
    const make = cleanText(input.make,80);
    const model = cleanText(input.model,100);
    const year = Number(input.year) || 0;
    const engine = cleanText(input.engine_code || input.engineCode,100);
    const transmission = cleanText(input.transmission,120);
    const market = cleanText(input.market,80);
    const body = cleanText(input.body_style || input.bodyStyle,80);
    const drivetrain = cleanText(input.drivetrain,80);
    if (!make || !model || !year) return null;
    const rows = this.db.prepare(`SELECT * FROM knowledge_objectives WHERE type='automotive' AND lower(make)=lower(?) AND lower(model)=lower(?) AND year=? ORDER BY created_at ASC`).all(make,model,year);
    const n = value => normalize(value);
    return rows.find(row => {
      if (n(row.engine_code) !== n(engine)) return false;
      if (n(row.transmission) !== n(transmission)) return false;
      if (n(row.market) !== n(market)) return false;
      if (n(row.body_style) !== n(body)) return false;
      if (n(row.drivetrain) !== n(drivetrain)) return false;
      return true;
    }) || null;
  }

  createFactoryCurriculum(input = {}) {
    const make = cleanText(input.make,80);
    const model = cleanText(input.model,100);
    const startYear = Number(input.start_year ?? input.startYear);
    const endYear = Number(input.end_year ?? input.endYear);
    const market = cleanText(input.market || 'US',80) || 'US';
    const threshold = Math.max(0.50, Math.min(1, Number(input.completion_threshold ?? input.completionThreshold ?? 0.85) || 0.85));
    if (!make || !model) throw new Error('La fábrica necesita fabricante y modelo.');
    if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear < 1886 || endYear > 2100 || startYear > endYear) throw new Error('Rango de años inválido.');
    if ((endYear - startYear) > 150) throw new Error('El rango no puede superar 150 años.');
    const row = {
      id:makeId('curriculum'), name:cleanText(input.name,180) || `${make} ${model} ${market} ${startYear}-${endYear}`,
      make, model, start_year:startYear, end_year:endYear, market, completion_threshold:threshold,
      status:'PAUSED', auto_continue:input.auto_continue === false ? 0 : 1, created_at:nowIso(), updated_at:nowIso(),
    };
    this.db.prepare(`INSERT INTO knowledge_factory_curricula(id,name,make,model,start_year,end_year,market,completion_threshold,status,auto_continue,created_at,updated_at)
      VALUES(@id,@name,@make,@model,@start_year,@end_year,@market,@completion_threshold,@status,@auto_continue,@created_at,@updated_at)`).run(row);
    const yearStmt = this.db.prepare(`INSERT INTO knowledge_factory_years(id,curriculum_id,make,model,year,market,discovery_status,research_status,coverage,variant_count,completed_configs,total_configs,attempts,last_error,created_at,updated_at)
      VALUES(@id,@curriculum_id,@make,@model,@year,@market,'QUEUED','QUEUED',0,0,0,0,0,'',@created_at,@updated_at)`);
    for (let year=startYear; year<=endYear; year+=1) yearStmt.run({ id:makeId('factoryyear'), curriculum_id:row.id, make, model, year, market, created_at:nowIso(), updated_at:nowIso() });
    return this.getFactoryCurriculum(row.id);
  }

  getFactoryCurriculum(id) {
    const row = this.db.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM knowledge_factory_years y WHERE y.curriculum_id=c.id) AS year_count,
      (SELECT COUNT(*) FROM knowledge_factory_years y WHERE y.curriculum_id=c.id AND y.research_status='COMPLETE') AS complete_years,
      (SELECT COUNT(*) FROM knowledge_factory_years y WHERE y.curriculum_id=c.id AND y.research_status='NEEDS_REVIEW') AS review_years,
      (SELECT COUNT(*) FROM knowledge_factory_configs f WHERE f.curriculum_id=c.id) AS config_count,
      (SELECT COUNT(*) FROM knowledge_factory_configs f WHERE f.curriculum_id=c.id AND f.status='COMPLETE') AS complete_configs,
      (SELECT COUNT(*) FROM knowledge_factory_configs f WHERE f.curriculum_id=c.id AND f.status='NEEDS_REVIEW') AS review_configs
      FROM knowledge_factory_curricula c WHERE c.id=?`).get(String(id));
    if (!row) return null;
    return { ...row, auto_continue:Boolean(row.auto_continue) };
  }

  listFactoryCurricula() {
    return this.db.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM knowledge_factory_years y WHERE y.curriculum_id=c.id) AS year_count,
      (SELECT COUNT(*) FROM knowledge_factory_years y WHERE y.curriculum_id=c.id AND y.research_status='COMPLETE') AS complete_years,
      (SELECT COUNT(*) FROM knowledge_factory_years y WHERE y.curriculum_id=c.id AND y.research_status='NEEDS_REVIEW') AS review_years,
      (SELECT COUNT(*) FROM knowledge_factory_configs f WHERE f.curriculum_id=c.id) AS config_count,
      (SELECT COUNT(*) FROM knowledge_factory_configs f WHERE f.curriculum_id=c.id AND f.status='COMPLETE') AS complete_configs,
      (SELECT COUNT(*) FROM knowledge_factory_configs f WHERE f.curriculum_id=c.id AND f.status='NEEDS_REVIEW') AS review_configs,
      COALESCE((SELECT AVG(y.coverage) FROM knowledge_factory_years y WHERE y.curriculum_id=c.id),0) AS avg_coverage
      FROM knowledge_factory_curricula c ORDER BY c.created_at DESC`).all().map(row => ({ ...row, auto_continue:Boolean(row.auto_continue) }));
  }

  deleteFactoryCurriculum(id) {
    this.db.prepare('DELETE FROM knowledge_factory_curricula WHERE id=?').run(String(id));
    return true;
  }

  setFactoryCurriculumStatus(id, status) {
    const allowed = new Set(['PAUSED','RUNNING','COMPLETE','ERROR']);
    const value = allowed.has(String(status).toUpperCase()) ? String(status).toUpperCase() : 'PAUSED';
    this.db.prepare('UPDATE knowledge_factory_curricula SET status=?,updated_at=? WHERE id=?').run(value,nowIso(),String(id));
    return this.getFactoryCurriculum(id);
  }

  listFactoryYears(curriculumId) {
    return this.db.prepare('SELECT * FROM knowledge_factory_years WHERE curriculum_id=? ORDER BY year ASC').all(String(curriculumId));
  }

  resetFactoryDiscoveryReviews(curriculumId) {
    const id=String(curriculumId);
    this.db.prepare(`UPDATE knowledge_factory_years
      SET discovery_status='QUEUED', research_status='QUEUED', attempts=0, last_error='Reintentando discovery con fallback seguro.', updated_at=?
      WHERE curriculum_id=? AND discovery_status='NEEDS_REVIEW' AND total_configs=0`).run(nowIso(),id);
    return this.listFactoryYears(id);
  }

  getFactoryYear(id) { return this.db.prepare('SELECT * FROM knowledge_factory_years WHERE id=?').get(String(id)) || null; }

  setFactoryYearState(id, patch = {}) {
    const row = this.getFactoryYear(id);
    if (!row) throw new Error('Año de fábrica no encontrado.');
    const next = { ...row };
    for (const key of ['discovery_status','research_status','last_error']) if (Object.prototype.hasOwnProperty.call(patch,key)) next[key] = cleanText(patch[key], key==='last_error'?2000:40);
    for (const key of ['coverage']) if (Object.prototype.hasOwnProperty.call(patch,key)) next[key] = Math.max(0,Math.min(1,Number(patch[key])||0));
    for (const key of ['variant_count','completed_configs','total_configs','attempts']) if (Object.prototype.hasOwnProperty.call(patch,key)) next[key] = Math.max(0,Number(patch[key])||0);
    next.updated_at = nowIso();
    this.db.prepare(`UPDATE knowledge_factory_years SET discovery_status=@discovery_status,research_status=@research_status,coverage=@coverage,variant_count=@variant_count,completed_configs=@completed_configs,total_configs=@total_configs,attempts=@attempts,last_error=@last_error,updated_at=@updated_at WHERE id=@id`).run({
      id:next.id, discovery_status:next.discovery_status, research_status:next.research_status, coverage:next.coverage,
      variant_count:next.variant_count, completed_configs:next.completed_configs, total_configs:next.total_configs,
      attempts:next.attempts, last_error:next.last_error, updated_at:next.updated_at,
    });
    return this.getFactoryYear(id);
  }

  technicalVehicleKey(input = {}) {
    return [input.make,input.model,input.year,input.market,input.generation,input.body_style||input.bodyStyle,input.engine_code||input.engineCode,input.engine_displacement||input.engineDisplacement,input.transmission,input.drivetrain]
      .map(value => normalize(value)).join('|');
  }

  upsertFactoryConfig(curriculumId, yearId, variant = {}, sources = []) {
    const yearRow = this.getFactoryYear(yearId);
    if (!yearRow || yearRow.curriculum_id !== String(curriculumId)) throw new Error('El año no pertenece a este curriculum.');
    const base = {
      make:cleanText(variant.make || yearRow.make,80), model:cleanText(variant.model || yearRow.model,100), year:Number(variant.year)||yearRow.year,
      market:cleanText(variant.market || yearRow.market,80), generation:cleanText(variant.generation,80), body_style:cleanText(variant.body_style || variant.bodyStyle,80),
      engine_code:cleanText(variant.engine_code || variant.engineCode,100), engine_displacement:cleanText(variant.engine_displacement || variant.engineDisplacement,60),
      fuel_type:cleanText(variant.fuel_type || variant.fuelType,60), transmission:cleanText(variant.transmission,120), drivetrain:cleanText(variant.drivetrain,80),
    };
    const trims = [...new Set((Array.isArray(variant.trims) ? variant.trims : [variant.trim]).map(v => cleanText(v,100)).filter(Boolean))];
    const key = this.technicalVehicleKey(base);
    const existing = this.db.prepare('SELECT * FROM knowledge_factory_configs WHERE curriculum_id=? AND technical_key=?').get(String(curriculumId),key);
    if (existing) {
      const merged = [...new Set([...parseJson(existing.trims_json,[]),...trims])];
      const mergedSources = [...parseJson(existing.sources_json,[]), ...(Array.isArray(sources)?sources:[])].slice(0,20);
      this.db.prepare('UPDATE knowledge_factory_configs SET trims_json=?,sources_json=?,confidence=?,updated_at=? WHERE id=?')
        .run(JSON.stringify(merged),JSON.stringify(mergedSources),Math.max(Number(existing.confidence)||0,Number(variant.confidence)||0),nowIso(),existing.id);
      return this.getFactoryConfig(existing.id);
    }
    let objective = this.findMatchingAutomotiveObjective(base);
    if (!objective) {
      const trimText = trims.join(', ');
      objective = this.createObjective({
        type:'automotive', make:base.make, model:base.model, year:base.year, generation:base.generation, trim:trimText,
        engine_code:base.engine_code, engine_displacement:base.engine_displacement, fuel_type:base.fuel_type,
        transmission:base.transmission, drivetrain:base.drivetrain, body_style:base.body_style, market:base.market,
        name:[base.make,base.model,base.year,base.engine_code||base.engine_displacement,base.transmission].filter(Boolean).join(' '),
        description:'Creado automáticamente por Auto Knowledge Factory. Trims detectados: ' + (trimText || 'por identificar') + '.',
      });
    }
    const row = {
      id:makeId('factorycfg'), curriculum_id:String(curriculumId), year_id:String(yearId), ...base, trims_json:JSON.stringify(trims), technical_key:key,
      objective_id:objective.id, status:'QUEUED', coverage:0, confidence:Math.max(0,Math.min(1,Number(variant.confidence)||0)),
      verified_count:0, partial_count:0, missing_count:AUTOMOTIVE_BASE_TOPICS.length, conflicting_count:0, attempts:0, last_error:'',
      sources_json:JSON.stringify(Array.isArray(sources)?sources.slice(0,20):[]), created_at:nowIso(), updated_at:nowIso(),
    };
    this.db.prepare(`INSERT INTO knowledge_factory_configs(id,curriculum_id,year_id,make,model,year,market,generation,body_style,trims_json,engine_code,engine_displacement,fuel_type,transmission,drivetrain,technical_key,objective_id,status,coverage,confidence,verified_count,partial_count,missing_count,conflicting_count,attempts,last_error,sources_json,created_at,updated_at)
      VALUES(@id,@curriculum_id,@year_id,@make,@model,@year,@market,@generation,@body_style,@trims_json,@engine_code,@engine_displacement,@fuel_type,@transmission,@drivetrain,@technical_key,@objective_id,@status,@coverage,@confidence,@verified_count,@partial_count,@missing_count,@conflicting_count,@attempts,@last_error,@sources_json,@created_at,@updated_at)`).run(row);
    return this.getFactoryConfig(row.id);
  }

  getFactoryConfig(id) {
    const row = this.db.prepare('SELECT * FROM knowledge_factory_configs WHERE id=?').get(String(id));
    return row ? { ...row, trims:parseJson(row.trims_json,[]), sources:parseJson(row.sources_json,[]) } : null;
  }

  listFactoryConfigs(curriculumId, year = null) {
    const rows = year == null
      ? this.db.prepare('SELECT * FROM knowledge_factory_configs WHERE curriculum_id=? ORDER BY year ASC, created_at ASC').all(String(curriculumId))
      : this.db.prepare('SELECT * FROM knowledge_factory_configs WHERE curriculum_id=? AND year=? ORDER BY created_at ASC').all(String(curriculumId),Number(year));
    return rows.map(row => ({ ...row, trims:parseJson(row.trims_json,[]), sources:parseJson(row.sources_json,[]) }));
  }

  refreshFactoryConfigProgress(configId, completionThreshold = 0.85) {
    const config = this.getFactoryConfig(configId);
    if (!config) throw new Error('Configuración de fábrica no encontrada.');
    const objective = this.getObjective(config.objective_id);
    if (!objective) return config;
    const counts = this.db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='VERIFIED' THEN 1 ELSE 0 END) AS verified,
      SUM(CASE WHEN status='PARTIAL' THEN 1 ELSE 0 END) AS partial,
      SUM(CASE WHEN status='MISSING' THEN 1 ELSE 0 END) AS missing,
      SUM(CASE WHEN status='CONFLICTING' THEN 1 ELSE 0 END) AS conflicting
      FROM objective_topics WHERE objective_id=?`).get(objective.id);
    const total = Math.max(1,Number(counts.total)||0);
    const verified = Number(counts.verified)||0, partial=Number(counts.partial)||0, missing=Number(counts.missing)||0, conflicting=Number(counts.conflicting)||0;
    const coverage = Math.max(0,Math.min(1,(verified + partial*0.6)/total));
    const status = coverage >= Number(completionThreshold || 0.85) ? 'COMPLETE' : (config.status === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : 'RESEARCHING');
    this.db.prepare(`UPDATE knowledge_factory_configs SET coverage=?,verified_count=?,partial_count=?,missing_count=?,conflicting_count=?,status=?,updated_at=? WHERE id=?`)
      .run(coverage,verified,partial,missing,conflicting,status,nowIso(),config.id);
    this.refreshFactoryYearProgress(config.year_id, completionThreshold);
    return this.getFactoryConfig(config.id);
  }

  refreshFactoryYearProgress(yearId, completionThreshold = 0.85) {
    const year = this.getFactoryYear(yearId);
    if (!year) return null;
    const configs = this.listFactoryConfigs(year.curriculum_id,year.year);
    const total = configs.length;
    const complete = configs.filter(c => c.status==='COMPLETE').length;
    const review = configs.filter(c => c.status==='NEEDS_REVIEW').length;
    const coverage = total ? configs.reduce((sum,c)=>sum+Number(c.coverage||0),0)/total : 0;
    let researchStatus = year.research_status;
    if (year.discovery_status === 'NEEDS_REVIEW') researchStatus = 'NEEDS_REVIEW';
    else if (year.discovery_status === 'COMPLETE' && total && complete + review >= total) researchStatus = complete === total ? 'COMPLETE' : 'NEEDS_REVIEW';
    else if (year.discovery_status === 'COMPLETE' && total) researchStatus = 'RESEARCHING';
    this.setFactoryYearState(year.id,{ research_status:researchStatus, coverage, completed_configs:complete, total_configs:total, variant_count:total });
    return this.getFactoryYear(year.id);
  }

  setFactoryConfigState(id, patch = {}) {
    const row = this.getFactoryConfig(id);
    if (!row) throw new Error('Configuración no encontrada.');
    const status = Object.prototype.hasOwnProperty.call(patch,'status') ? cleanText(patch.status,40) : row.status;
    const attempts = Object.prototype.hasOwnProperty.call(patch,'attempts') ? Math.max(0,Number(patch.attempts)||0) : row.attempts;
    const lastError = Object.prototype.hasOwnProperty.call(patch,'last_error') ? cleanText(patch.last_error,2000) : row.last_error;
    this.db.prepare('UPDATE knowledge_factory_configs SET status=?,attempts=?,last_error=?,updated_at=? WHERE id=?').run(status,attempts,lastError,nowIso(),row.id);
    return this.getFactoryConfig(row.id);
  }

  nextFactoryWork(curriculumId) {
    const curriculum = this.getFactoryCurriculum(curriculumId);
    if (!curriculum) return null;
    const years = this.listFactoryYears(curriculum.id);
    for (const year of years) {
      if (year.discovery_status !== 'COMPLETE' && year.discovery_status !== 'NEEDS_REVIEW') return { type:'DISCOVER_YEAR', curriculum, year };
      if (year.discovery_status === 'NEEDS_REVIEW') continue;
      const configs = this.listFactoryConfigs(curriculum.id,year.year);
      for (const config of configs) if (!['COMPLETE','NEEDS_REVIEW'].includes(config.status)) return { type:'RESEARCH_CONFIG', curriculum, year, config };
      const refreshed = this.refreshFactoryYearProgress(year.id,curriculum.completion_threshold);
      if (refreshed && !['COMPLETE','NEEDS_REVIEW'].includes(refreshed.research_status)) {
        if (!configs.length) return { type:'DISCOVER_YEAR', curriculum, year:refreshed };
      }
    }
    return null;
  }

  factoryStats() {
    const curricula = Number(this.db.prepare('SELECT COUNT(*) AS c FROM knowledge_factory_curricula').get().c||0);
    const years = Number(this.db.prepare('SELECT COUNT(*) AS c FROM knowledge_factory_years').get().c||0);
    const configs = Number(this.db.prepare('SELECT COUNT(*) AS c FROM knowledge_factory_configs').get().c||0);
    const completeConfigs = Number(this.db.prepare("SELECT COUNT(*) AS c FROM knowledge_factory_configs WHERE status='COMPLETE'").get().c||0);
    return { curricula, years, configs, completeConfigs };
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
    for (const table of ['knowledge_objectives','objective_topics','knowledge_entries','knowledge_sources','research_runs','research_evidence','browser_captures','browser_commands','knowledge_factory_curricula','knowledge_factory_years','knowledge_factory_configs']) {
      counts[table] = Number(this.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c || 0);
    }
    counts.active_entries = Number(this.db.prepare('SELECT COUNT(*) AS c FROM knowledge_entries WHERE active=1').get().c || 0);
    counts.verified_entries = Number(this.db.prepare("SELECT COUNT(*) AS c FROM knowledge_entries WHERE active=1 AND verification_status='VERIFIED'").get().c || 0);
    counts.partial_entries = Number(this.db.prepare("SELECT COUNT(*) AS c FROM knowledge_entries WHERE active=1 AND verification_status='PARTIAL'").get().c || 0);
    counts.saved_evidence = Number(this.db.prepare('SELECT COUNT(*) AS c FROM research_evidence').get().c || 0);
    return { dbPath:this.path, ...counts };
  }
}

module.exports = { PersistentKnowledgeDB, AUTOMOTIVE_BASE_TOPICS, VALID_STATUSES };
