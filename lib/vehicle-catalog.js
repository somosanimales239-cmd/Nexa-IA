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


function parseJsonCatalog(text, defaults = {}) {
  const source = String(text || '').trim();
  if (!source) return null;
  const candidates = [];
  candidates.push(source);
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);
  const firstObj = source.indexOf('{'), lastObj = source.lastIndexOf('}');
  if (firstObj >= 0 && lastObj > firstObj) candidates.push(source.slice(firstObj,lastObj+1));
  const firstArr = source.indexOf('['), lastArr = source.lastIndexOf(']');
  if (firstArr >= 0 && lastArr > firstArr) candidates.push(source.slice(firstArr,lastArr+1));
  for (const candidate of candidates) {
    let parsed;
    try { parsed = JSON.parse(candidate); } catch (_) { continue; }
    const rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.variants) ? parsed.variants : Array.isArray(parsed?.configurations) ? parsed.configurations : Array.isArray(parsed?.vehicles) ? parsed.vehicles : []);
    if (!rows.length) continue;
    const variants = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const variant = {
        make:clean(row.make || defaults.make,80), model:clean(row.model || defaults.model,100), year:Number(row.year || defaults.year)||null, market:clean(row.market || defaults.market,80),
        generation:clean(row.generation || row.chassis || row.platform,80), body_style:clean(row.body_style || row.body || row.bodyStyle,80),
        trims:Array.isArray(row.trims) ? row.trims.map(v=>clean(v,100)).filter(Boolean) : splitCsv(row.trims || row.trim),
        engine_code:clean(row.engine_code || row.engine || row.engineCode,100), engine_displacement:clean(row.engine_displacement || row.displacement || row.engineDisplacement,60),
        fuel_type:clean(row.fuel_type || row.fuel || row.fuelType,60), transmission:clean(row.transmission || row.gearbox,120), drivetrain:clean(row.drivetrain || row.drive,80),
        confidence:number01(row.confidence,0.55), source_indexes:(Array.isArray(row.source_indexes)?row.source_indexes:splitCsv(row.source_indexes || row.sources)).map(v=>Number(v)).filter(n=>Number.isInteger(n)&&n>0).slice(0,20),
      };
      const identity=[variant.generation,variant.body_style,variant.engine_code,variant.engine_displacement,variant.transmission,variant.drivetrain,...variant.trims].map(normalizeKey).filter(Boolean);
      if (identity.length) variants.push(variant);
    }
    const unique=dedupeVariants(variants);
    if (unique.length) return { make:clean(defaults.make,80),model:clean(defaults.model,100),year:Number(defaults.year)||null,market:clean(defaults.market,80),variants:unique,parser:'json-flex' };
  }
  return null;
}

function parseLooseCatalog(text, defaults = {}) {
  const source = String(text || '').trim();
  if (!source) return null;
  const field = name => {
    const re = new RegExp('(?:^|\\n)\\s*' + name + '\\s*[:=-]\\s*([^\\n]+)','i');
    const m = source.match(re); return m ? m[1].trim() : '';
  };
  const variant = {
    make:clean(defaults.make,80),model:clean(defaults.model,100),year:Number(defaults.year)||null,market:clean(defaults.market,80),
    generation:clean(field('generation|chassis|platform'),80),body_style:clean(field('body(?: style)?'),80),trims:splitCsv(field('trims?|grades?')),
    engine_code:clean(field('engine(?: code)?'),100),engine_displacement:clean(field('(?:engine )?displacement'),60),fuel_type:clean(field('fuel(?: type)?'),60),
    transmission:clean(field('transmission|gearbox'),120),drivetrain:clean(field('drivetrain|drive'),80),confidence:number01(field('confidence'),0.5),source_indexes:splitCsv(field('source(?:_indexes| indexes|s)?')).map(v=>Number(v)).filter(n=>Number.isInteger(n)&&n>0).slice(0,20),
  };
  const identity=[variant.generation,variant.body_style,variant.engine_code,variant.engine_displacement,variant.transmission,variant.drivetrain,...variant.trims].map(normalizeKey).filter(Boolean);
  return identity.length ? { make:variant.make,model:variant.model,year:variant.year,market:variant.market,variants:[variant],parser:'loose-fields' } : null;
}

function fallbackCatalogFromEvidence(sources = [], defaults = {}) {
  const make = clean(defaults.make,80), model = clean(defaults.model,100), year = Number(defaults.year)||null, market = clean(defaults.market,80);
  const chunks=(sources||[]).map((s,i)=>({ i:i+1, text:[s?.title,s?.snippet,s?.text].filter(Boolean).join(' ') }));
  const exact = chunks.filter(c => {
    const n=normalizeKey(c.text); return (!make || n.includes(normalizeKey(make))) && (!model || n.includes(normalizeKey(model))) && (!year || n.includes(String(year)));
  });
  if (!exact.length) return null;
  const corpus=exact.map(c=>c.text).join(' ').replace(/\s+/g,' ');
  const uniq=(arr,max=12)=>[...new Set(arr.map(v=>String(v||'').trim()).filter(Boolean))].slice(0,max);
  const displacements=uniq([...corpus.matchAll(/\b([0-9](?:\.[0-9])?)\s*(?:L|liter|litre)\b/gi)].map(m=>m[1]+'L'),8);
  const transmissions=uniq([...corpus.matchAll(/\b([2-9])[- ]speed\s+(manual|automatic)\b/gi)].map(m=>m[1]+'-speed '+m[2].toLowerCase()),8);
  const bodies=uniq([...corpus.matchAll(/\b(sedan|coupe|wagon|hatchback|liftback|hardtop|convertible|van|pickup)\b/gi)].map(m=>m[1].toLowerCase()),6);
  const drives=uniq([...corpus.matchAll(/\b(FWD|RWD|AWD|4WD)\b/gi)].map(m=>m[1].toUpperCase()),4);
  const chassis=uniq([...corpus.matchAll(/\b(E\d{2,3}[A-Z]?)\b/g)].map(m=>m[1]),4);
  const engineCodes=uniq([...corpus.matchAll(/\b(?:[1-9][A-Z]{1,3}(?:-[A-Z0-9]{1,8})?|[1-9][A-Z]-[A-Z0-9]{1,8})\b/g)].map(m=>m[0]).filter(v=>!/^\d{4}$/.test(v)),10);
  const source_indexes=exact.map(c=>c.i).slice(0,8);
  const variants=[];
  const base={ make,model,year,market,generation:chassis[0]||'',body_style:bodies.length===1?bodies[0]:'',trims:[],fuel_type:'',drivetrain:drives.length===1?drives[0]:'',confidence:0.48,source_indexes };
  if (engineCodes.length) {
    for (const code of engineCodes.slice(0,6)) variants.push({ ...base,engine_code:code,engine_displacement:displacements.length===1?displacements[0]:'',transmission:transmissions.length===1?transmissions[0]:'' });
  } else if (displacements.length) {
    for (const disp of displacements.slice(0,6)) variants.push({ ...base,engine_code:'',engine_displacement:disp,transmission:transmissions.length===1?transmissions[0]:'' });
  } else {
    variants.push({ ...base,engine_code:'',engine_displacement:'',transmission:transmissions.length===1?transmissions[0]:'',confidence:0.35,needs_review:true });
  }
  return { make,model,year,market,variants:dedupeVariants(variants),parser:'evidence-fallback',partial:true };
}

function parseFlexibleVehicleCatalog(text, defaults = {}) {
  return parseVehicleCatalog(text,defaults) || parseJsonCatalog(text,defaults) || parseLooseCatalog(text,defaults);
}

function genericVariant(defaults = {}, confidence = 0.35) {
  return {
    make:clean(defaults.make,80), model:clean(defaults.model,100), year:Number(defaults.year)||null, market:clean(defaults.market,80),
    generation:'', body_style:'', trims:[], engine_code:'', engine_displacement:'', fuel_type:'', transmission:'', drivetrain:'',
    confidence:number01(confidence,0.35), source_indexes:[], needs_review:true,
  };
}

module.exports = { catalogProtocolInstructions, parseVehicleCatalog, parseFlexibleVehicleCatalog, fallbackCatalogFromEvidence, genericVariant, dedupeVariants, normalizeKey };
