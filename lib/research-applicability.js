'use strict';

function normalize(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const UNKNOWN_PATTERNS = [
  'unknown', 'not known', 'to be identified', 'tbd', 'n a', 'na', 'none', 'unspecified',
  'multiple', 'multiple options', 'all', 'various', 'pending', 'por identificar', 'desconocido'
];

function meaningfulValue(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  const n = normalize(raw);
  if (!n) return '';
  for (const pattern of UNKNOWN_PATTERNS) {
    const p = normalize(pattern);
    if (n === p || n.includes(p)) return '';
  }
  return raw;
}

function normalizedNeedle(value) {
  return normalize(String(value == null ? '' : value).replace(/[-_/]+/g, ' '));
}

function compactNeedle(value) {
  return normalize(value).replace(/\s+/g, '');
}

function containsValue(haystack, value) {
  const raw = meaningfulValue(value);
  if (!raw) return true;
  const h = normalize(haystack);
  const n = normalizedNeedle(raw);
  if (n && h.includes(n)) return true;
  const hc = h.replace(/\s+/g, '');
  const nc = compactNeedle(raw);
  return Boolean(nc && hc.includes(nc));
}

function topicRules(topic) {
  const t = normalize(topic);
  const transmissionSensitive = /transmission|drivetrain|cvt|gearbox|clutch|transaxle|differential|axle/.test(t);
  const engineSensitive = /engine|fuel|ignition|cooling|lubrication|intake|exhaust|starting|charging|dtc|diagnostic|torque|timing|compression|spark|injector|oil|fluid|capacity/.test(t);
  const marketSensitive = /recall|bulletin|tsb|emission|campaign|safety|airbag|srs|adas/.test(t);
  return { transmissionSensitive, engineSensitive, marketSensitive };
}

function objectiveScope(objective, topic) {
  const rules = topicRules(topic);
  const scope = {
    make: meaningfulValue(objective && objective.make),
    model: meaningfulValue(objective && objective.model),
    year: objective && objective.year ? String(objective.year) : '',
    engine: meaningfulValue(objective && objective.engine_code),
    displacement: meaningfulValue(objective && objective.engine_displacement),
    transmission: meaningfulValue(objective && objective.transmission),
    market: meaningfulValue(objective && objective.market),
    generation: meaningfulValue(objective && objective.generation),
    trim: meaningfulValue(objective && objective.trim),
  };
  return {
    ...scope,
    required: {
      make: Boolean(scope.make),
      model: Boolean(scope.model),
      year: Boolean(scope.year),
      engine: Boolean(scope.engine && rules.engineSensitive),
      transmission: Boolean(scope.transmission && rules.transmissionSensitive),
      market: Boolean(scope.market && rules.marketSensitive),
    },
    rules,
  };
}


const TOPIC_SYNONYMS = {
  'vehicle identification': ['vehicle identification','vin','model year','vehicle model','corolla'],
  'engine': ['engine','motor'],
  'engine control': ['engine control','ecm','ecu','engine computer','diagnostic trouble code','dtc'],
  'fuel system': ['fuel system','fuel pressure','fuel pump','injector','fuel injector'],
  'ignition': ['ignition','spark plug','ignition coil','coil pack'],
  'cooling system': ['cooling system','coolant','radiator','thermostat'],
  'lubrication': ['lubrication','engine oil','oil capacity','oil filter'],
  'intake': ['intake','throttle body','intake manifold','air cleaner'],
  'exhaust': ['exhaust','catalytic converter','oxygen sensor','muffler'],
  'transmission': ['transmission','transaxle','gearbox','automatic transmission','manual transmission'],
  'drivetrain': ['drivetrain','drive shaft','cv joint','axle','differential'],
  'electrical': ['electrical','wiring','voltage','circuit'],
  'charging system': ['charging system','alternator','charging voltage'],
  'starting system': ['starting system','starter','starter motor'],
  'wiring diagrams': ['wiring diagram','electrical diagram','circuit diagram'],
  'connector pinouts': ['pinout','connector pin','terminal'],
  'brakes': ['brake','braking'],
  'abs': ['abs','anti lock brake','anti-lock brake'],
  'steering': ['steering','power steering'],
  'suspension': ['suspension','strut','shock absorber','control arm'],
  'air conditioning': ['air conditioning','a c','refrigerant','compressor'],
  'heating': ['heater','heating','heater core'],
  'airbag srs': ['airbag','srs','supplemental restraint'],
  'body': ['body','door','body panel'],
  'lighting': ['lighting','headlamp','headlight','tail lamp'],
  'adas driver assistance': ['adas','driver assistance','lane','radar','camera calibration'],
  'maintenance': ['maintenance','service interval','maintenance schedule'],
  'fluids': ['fluid','oil','coolant','refrigerant'],
  'capacities': ['capacity','capacities','litre','liter','quart'],
  'torque specifications': ['torque','tightening torque'],
  'diagnostic trouble codes': ['diagnostic trouble code','dtc','p0','b0','c0','u0'],
  'technical service bulletins': ['technical service bulletin','tsb','service bulletin'],
  'recalls': ['recall','safety recall','campaign'],
  'repair procedures': ['repair procedure','repair manual','service procedure'],
  'removal installation': ['removal','installation','remove','install'],
  'testing inspection': ['testing','inspection','test procedure','inspect'],
  'specifications': ['specification','specifications','service specifications'],
};

function topicKey(topic) {
  return normalize(topic).replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
}

function topicRelevant(text, topic) {
  const h = normalize(text);
  const key = topicKey(topic);
  if (!key) return false;
  if (h.includes(key)) return true;
  const synonyms = TOPIC_SYNONYMS[key] || [];
  return synonyms.some(term => h.includes(normalize(term)));
}

function sourceText(source) {
  return [source && source.title, source && source.snippet, source && source.text, source && source.domain]
    .filter(Boolean)
    .join(' ');
}

function sourceRank(type) {
  const v = String(type || '').toLowerCase();
  if (v === 'oem') return 4;
  if (v === 'government') return 3;
  if (v === 'technical') return 2;
  if (v === 'secondary') return 1;
  return 0;
}

function matchSource(source, scope) {
  const text = sourceText(source);
  const matches = {
    make: containsValue(text, scope.make),
    model: containsValue(text, scope.model),
    year: containsValue(text, scope.year),
    engine: containsValue(text, scope.engine),
    transmission: containsValue(text, scope.transmission),
    market: containsValue(text, scope.market),
  };
  const requiredKeys = Object.keys(scope.required).filter(key => scope.required[key]);
  const matchedRequired = requiredKeys.filter(key => matches[key]).length;
  const requiredOk = requiredKeys.length === matchedRequired;
  return {
    requiredOk,
    matchedRequired,
    requiredCount: requiredKeys.length,
    matches,
    sourceRank: sourceRank(source && source.sourceType),
  };
}

function topicTerms(topic) {
  const normalized = normalize(topic);
  const parts = normalized.split(' ').filter(part => part.length > 2);
  return [...new Set(parts)].slice(0, 8);
}

function splitEvidenceText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .split(/\n+|(?<=[.!?])\s+/)
    .map(item => item.replace(/\s+/g, ' ').trim())
    .filter(item => item.length >= 18 && item.length <= 700);
}

function extractEvidenceLines(source, topic, objective, limit = 5) {
  const text = String((source && (source.text || source.snippet)) || '');
  if (!text) return [];
  const terms = topicTerms(topic);
  const identity = [objective && objective.make, objective && objective.model, objective && objective.engine_code, objective && objective.year]
    .map(normalize)
    .filter(Boolean);
  const scored = [];
  for (const line of splitEvidenceText(text)) {
    const n = normalize(line);
    let score = 0;
    for (const term of terms) if (n.includes(term)) score += 4;
    for (const term of identity) {
      const compact = term.replace(/\s+/g, '');
      if (n.includes(term) || n.replace(/\s+/g, '').includes(compact)) score += 2;
    }
    if (/service specification|specification|engine|model|fuel|capacity|spark plug|valve|transmission|recall|diagnostic|maintenance/.test(n)) score += 1;
    if (score > 0) scored.push({ score, line });
  }
  scored.sort((a, b) => b.score - a.score || a.line.length - b.line.length);
  const output = [];
  const seen = new Set();
  for (const item of scored) {
    const key = normalize(item.line);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item.line);
    if (output.length >= limit) break;
  }
  return output;
}

function assessApplicability(objective, topic, sources) {
  const scope = objectiveScope(objective || {}, topic);
  const details = [];
  let exact = 0;
  let exactTrusted = 0;
  let exactTechnical = 0;
  let highestRank = 0;
  const evidence = [];

  for (let i = 0; i < (sources || []).length; i += 1) {
    const source = sources[i];
    const match = matchSource(source, scope);
    const relevant = topicRelevant(sourceText(source), topic);
    highestRank = Math.max(highestRank, match.sourceRank);
    if (match.requiredOk && relevant) {
      exact += 1;
      if (match.sourceRank >= 3) exactTrusted += 1;
      if (match.sourceRank >= 2) exactTechnical += 1;
      const lines = extractEvidenceLines(source, topic, objective, 4);
      for (const line of lines) {
        evidence.push({ sourceIndex: i + 1, text: line, sourceType: source.sourceType || '', title: source.title || '' });
      }
    }
    details.push({ sourceIndex: i + 1, topicRelevant:relevant, ...match });
  }

  let confidence = 0;
  let recommendedStatus = 'NOT VERIFIED';
  const unresolvedRelevantField = Boolean(
    (scope.rules.engineSensitive && !scope.engine) ||
    (scope.rules.transmissionSensitive && !scope.transmission) ||
    (scope.rules.marketSensitive && !scope.market)
  );
  if (exactTrusted >= 1 && evidence.length) {
    confidence = highestRank >= 4 ? 0.95 : 0.90;
    recommendedStatus = unresolvedRelevantField ? 'PARTIAL' : 'VERIFIED';
    if (unresolvedRelevantField) confidence = Math.min(confidence, 0.79);
  } else if (exactTechnical >= 2 && evidence.length) {
    confidence = 0.78;
    recommendedStatus = 'PARTIAL';
  } else if (exactTechnical >= 1 && evidence.length) {
    confidence = 0.64;
    recommendedStatus = 'PARTIAL';
  } else if (exact >= 1 && evidence.length) {
    confidence = 0.52;
    recommendedStatus = 'PARTIAL';
  }

  return {
    scope,
    exactSourceCount: exact,
    trustedSourceCount: exactTrusted,
    technicalSourceCount: exactTechnical,
    highestSourceRank: highestRank,
    unresolvedRelevantField,
    confidence,
    recommendedStatus,
    evidence: evidence.slice(0, 10),
    details,
  };
}

function fallbackKnowledgeFromEvidence(objective, topic, sources, assessment) {
  if (!assessment || assessment.recommendedStatus === 'NOT VERIFIED' || !assessment.evidence.length) return null;
  const selected = assessment.evidence.slice(0, 6);
  const summary = selected.map(item => item.text).join(' ').slice(0, 1800).trim();
  if (!summary) return null;
  const sourceIndexes = [...new Set(selected.map(item => item.sourceIndex))];
  return {
    verification_status: assessment.recommendedStatus,
    confidence: assessment.confidence,
    system: String(topic || ''),
    subsystem: '',
    topic: String(topic || ''),
    summary,
    content: {
      description: summary,
      facts: selected.map(item => item.text),
      procedures: [],
      specifications: [],
      warnings: [],
      related_topics: [],
    },
    applicable_years: objective && objective.year ? String(objective.year) : '',
    engine: meaningfulValue(objective && objective.engine_code),
    transmission: meaningfulValue(objective && objective.transmission),
    market: meaningfulValue(objective && objective.market),
    source_indexes: sourceIndexes,
    reason: 'Deterministic evidence fallback: exact objective applicability was found in the fetched source text. Stored conservatively without upgrading beyond the evidence quality.',
    parser: 'deterministic-evidence-fallback',
  };
}

module.exports = {
  meaningfulValue,
  topicRules,
  objectiveScope,
  assessApplicability,
  fallbackKnowledgeFromEvidence,
  extractEvidenceLines,
  containsValue,
  topicRelevant,
  normalize,
};
