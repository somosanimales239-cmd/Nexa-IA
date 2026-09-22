'use strict';

function clean(value, max = 300) { return String(value ?? '').trim().slice(0, max); }
function number01(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}
function splitCsv(value) {
  return [...new Set(String(value || '').split(/[,;|]/).map(v => v.trim()).filter(Boolean))].slice(0, 30);
}
function normalizeKey(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9+#.-]+/g,' ').replace(/\s+/g,' ').trim();
}

function catalogProtocolInstructions() {
  return [
    'Return plain text only using this exact protocol. Do not return JSON or Markdown fences.',
    'NEXA_VEHICLE_CATALOG_V1',
    'MAKE: <make>',
    'MODEL: <model>',
    'YEAR: <year>',
    'MARKET: <market>',
    'VARIANT',
    'GENERATION: <generation/chassis or blank>',
    'BODY: <body style or blank>',
    'TRIMS: <comma separated trims that share this technical configuration>',
    'ENGINE_CODE: <engine code or blank>',
    'ENGINE_DISPLACEMENT: <displacement or blank>',
    'FUEL: <fuel type or blank>',
    'TRANSMISSION: <specific transmission type or blank>',
    'DRIVETRAIN: <FWD/RWD/AWD/4WD or blank>',
    'CONFIDENCE: <0.00 to 1.00>',
    'SOURCE_INDEXES: <comma separated source numbers>',
    'END_VARIANT',
    'Repeat VARIANT blocks for distinct technical configurations.',
    'END_NEXA_VEHICLE_CATALOG',
  ].join('\n');
}

function parseVariantBlock(block, defaults = {}) {
  const data = {};
  for (const rawLine of String(block || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toUpperCase();
    const value = line.slice(idx + 1).trim();
    data[key] = value;
  }
  const variant = {
    make: clean(defaults.make,80), model: clean(defaults.model,100), year:Number(defaults.year)||null, market:clean(defaults.market,80),
    generation:clean(data.GENERATION,80), body_style:clean(data.BODY,80), trims:splitCsv(data.TRIMS),
    engine_code:clean(data.ENGINE_CODE,100), engine_displacement:clean(data.ENGINE_DISPLACEMENT,60), fuel_type:clean(data.FUEL,60),
    transmission:clean(data.TRANSMISSION,120), drivetrain:clean(data.DRIVETRAIN,80), confidence:number01(data.CONFIDENCE,0.55),
    source_indexes:splitCsv(data.SOURCE_INDEXES).map(v => Number(v)).filter(n => Number.isInteger(n) && n > 0).slice(0,20),
  };
  const identity = [variant.generation,variant.body_style,variant.engine_code,variant.engine_displacement,variant.transmission,variant.drivetrain,...variant.trims]
    .map(normalizeKey).filter(Boolean);
  return identity.length ? variant : null;
}

function dedupeVariants(variants) {
  const map = new Map();
  for (const item of variants || []) {
    if (!item) continue;
    const key = [item.make,item.model,item.year,item.market,item.generation,item.body_style,item.engine_code,item.engine_displacement,item.transmission,item.drivetrain]
      .map(normalizeKey).join('|');
    if (!map.has(key)) { map.set(key,{ ...item, trims:[...(item.trims||[])] }); continue; }
    const current = map.get(key);
    current.trims = [...new Set([...(current.trims||[]),...(item.trims||[])])];
    current.confidence = Math.max(Number(current.confidence)||0,Number(item.confidence)||0);
    current.source_indexes = [...new Set([...(current.source_indexes||[]),...(item.source_indexes||[])])].slice(0,20);
  }
  return [...map.values()];
}

function parseVehicleCatalog(text, defaults = {}) {
  const source = String(text || '').trim();
  if (!source) return null;
  const begin = source.indexOf('NEXA_VEHICLE_CATALOG_V1');
  const end = source.indexOf('END_NEXA_VEHICLE_CATALOG');
  const bounded = begin >= 0 ? source.slice(begin, end >= 0 ? end : undefined) : source;
  const header = {};
  for (const rawLine of bounded.split(/\r?\n/).slice(0,20)) {
    const line = rawLine.trim();
    if (line === 'VARIANT') break;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    header[line.slice(0,idx).trim().toUpperCase()] = line.slice(idx+1).trim();
  }
  const base = {
    make:clean(header.MAKE || defaults.make,80), model:clean(header.MODEL || defaults.model,100),
    year:Number(header.YEAR || defaults.year)||null, market:clean(header.MARKET || defaults.market,80),
  };
  const variants = [];
  const re = /(?:^|\n)VARIANT\s*\n([\s\S]*?)(?:\nEND_VARIANT|$)/gi;
  let match;
  while ((match = re.exec(bounded))) {
    const item = parseVariantBlock(match[1],base);
    if (item) variants.push(item);
  }
  const unique = dedupeVariants(variants);
  if (!unique.length) return null;
  return { ...base, variants:unique, parser:'nexa-catalog-protocol' };
}

function genericVariant(defaults = {}, confidence = 0.35) {
  return {
    make:clean(defaults.make,80), model:clean(defaults.model,100), year:Number(defaults.year)||null, market:clean(defaults.market,80),
    generation:'', body_style:'', trims:[], engine_code:'', engine_displacement:'', fuel_type:'', transmission:'', drivetrain:'',
    confidence:number01(confidence,0.35), source_indexes:[], needs_review:true,
  };
}

module.exports = { catalogProtocolInstructions, parseVehicleCatalog, genericVariant, dedupeVariants, normalizeKey };
