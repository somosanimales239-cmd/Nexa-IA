'use strict';

const MODEL = 'qwen2.5vl:3b';
const THRESHOLD = 86;
const MAX_ATTEMPTS = 3;

const CHECK_WEIGHTS = Object.freeze({
  subject_identity: 20,
  subject_count: 15,
  species_identity: 15,
  requested_attributes: 12,
  pose_action: 8,
  style: 10,
  framing: 10,
  anatomy: 7,
  background: 3,
  text_integrity: 2,
  technical_quality: 3,
});

const CRITICAL_ERRORS = new Set([
  'E001', // wrong main subject
  'E002', // wrong subject count
  'E003', // duplicate subject
  'E007', // wrong explicit style
  'E008', // wrong species
  'E010', // missing mandatory requested item/attribute
  'E015', // wrong requested color
  'E016', // wrong requested pose/action
  'E017', // wrong framing
  'E018', // character sheet / multiview instead of one composition
]);

const ALLOWED_CODES = new Set([
  'E001','E002','E003','E004','E005','E006','E007','E008','E009',
  'E010','E011','E012','E013','E014','E015','E016','E017','E018',
]);

const SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    subject_identity: { type:'string', enum:['pass','fail','uncertain','na'] },
    subject_count: { type:'string', enum:['pass','fail','uncertain','na'] },
    species_identity: { type:'string', enum:['pass','fail','uncertain','na'] },
    requested_attributes: { type:'string', enum:['pass','fail','uncertain','na'] },
    pose_action: { type:'string', enum:['pass','fail','uncertain','na'] },
    style: { type:'string', enum:['pass','fail','uncertain','na'] },
    framing: { type:'string', enum:['pass','fail','uncertain','na'] },
    anatomy: { type:'string', enum:['pass','fail','uncertain','na'] },
    background: { type:'string', enum:['pass','fail','uncertain','na'] },
    text_integrity: { type:'string', enum:['pass','fail','uncertain','na'] },
    technical_quality: { type:'string', enum:['pass','fail','uncertain','na'] },
    detected_subject_count: { type:'integer', minimum:0, maximum:20 },
    detected_subject: { type:'string' },
    detected_species: { type:'string' },
    confidence: { type:'number', minimum:0, maximum:1 },
    error_codes: { type:'array', items:{ type:'string', enum:[...ALLOWED_CODES] }, maxItems:18 },
    problems: { type:'array', items:{ type:'string' }, maxItems:12 },
    repair_positive: { type:'array', items:{ type:'string' }, maxItems:14 },
    repair_negative: { type:'array', items:{ type:'string' }, maxItems:14 },
  },
  required: [
    'subject_identity','subject_count','species_identity','requested_attributes','pose_action','style','framing',
    'anatomy','background','text_integrity','technical_quality','detected_subject_count',
    'detected_subject','detected_species','confidence','error_codes','problems','repair_positive','repair_negative',
  ],
  additionalProperties:false,
});

function clean(value, max = 12000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function unique(values, max = 30) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const value = clean(raw, 260);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

function mergePrompt(base, additions) {
  const first = clean(base);
  const extra = unique(additions);
  return extra.length ? (first ? first + ', ' + extra.join(', ') : extra.join(', ')) : first;
}


function sanitizePositiveBase(value) {
  let text = clean(value);
  const banned = [
    'character concept art', 'character sheet', 'turnaround sheet', 'reference sheet',
    'design sheet', 'contact sheet', 'multiple views', 'multiple poses', 'lineup'
  ];
  for (const phrase of banned) {
    const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
    text = text.replace(re, '');
  }
  return text.replace(/\s*,\s*,+/g, ', ').replace(/^\s*,|,\s*$/g, '').trim();
}

function deriveVisualSpec(userRequest) {
  const original = clean(userRequest, 6000);
  const text = original.toLowerCase();
  const spec = {
    original,
    exact_subject_count: null,
    requested_species: '',
    requested_style: '',
    requested_framing: '',
    requested_attributes: [],
    requested_pose: '',
  };

  if (/\b(exactly one|one single|single subject|one character)\b/.test(text) || /\b(un solo|una sola|exactamente un|exactamente una|solo un|solo una)\b/.test(text)) {
    spec.exact_subject_count = 1;
  }

  if (/\b(kangaroo|canguro|kanguro)\b/.test(text)) {
    spec.requested_species = 'kangaroo';
    if (spec.exact_subject_count === null && /\b(a|one|un|una)\s+(?:[a-záéíóúñ]+\s+){0,2}(kangaroo|canguro|kanguro)\b/.test(text)) spec.exact_subject_count = 1;
  }

  if (/\b(cartoon|dibujo animado|caricatura|animated illustration)\b/.test(text)) spec.requested_style = 'cartoon';
  else if (/\b(anime|manga)\b/.test(text)) spec.requested_style = 'anime';
  else if (/\b(photorealistic|fotorealista|realistic photo|foto realista)\b/.test(text)) spec.requested_style = 'photorealistic';
  else if (/\b(3d|cgi|render 3d)\b/.test(text)) spec.requested_style = '3d';

  if (/\b(close[- ]?up|tight framing|close framing)\b/.test(text) || /\b(encuadre (?:muy )?cercano|primer plano|plano cercano)\b/.test(text)) {
    spec.requested_framing = 'close';
  } else if (/\b(full body|head to toe)\b/.test(text) || /\b(cuerpo completo|de pies a cabeza)\b/.test(text)) {
    spec.requested_framing = 'full_body';
  }

  if ((/\b(red|rojo|rojos|rojas)\b/.test(text)) && (/\b(boxing gloves|gloves|guantes)\b/.test(text))) {
    spec.requested_attributes.push('red boxing gloves');
  }
  if ((/\b(red|rojo|rojos|rojas)\b/.test(text)) && (/\b(shorts|pantalones cortos|calzoncillos de boxeo)\b/.test(text))) {
    spec.requested_attributes.push('red boxing shorts');
  }
  if (/\b(dynamic pose|dynamic boxing pose|fighting pose)\b/.test(text) || /\b(pose dinámica|pose de pelea|pose de boxeo)\b/.test(text)) {
    spec.requested_pose = 'dynamic boxing pose';
  }

  return spec;
}


function targetDimensions(userRequest) {
  const spec = deriveVisualSpec(userRequest);
  if (spec.requested_framing === 'close') return { width:896, height:896 };
  if (spec.requested_framing === 'full_body') return { width:768, height:1024 };
  const text = clean(userRequest, 6000).toLowerCase();
  if (/\b(car|auto|coche|carro|truck|camion|camión|suv|vehicle|vehiculo|vehículo)\b/.test(text)) return { width:1024, height:768 };
  if (spec.requested_style === 'cartoon' || spec.requested_style === 'anime') return { width:896, height:896 };
  return null;
}

function augmentInitialRequest(userRequest) {
  const original = clean(userRequest, 6000);
  const spec = deriveVisualSpec(original);
  const additions = [];
  if (spec.exact_subject_count === 1) additions.push('exactly one main subject in exactly one pose');
  additions.push('one coherent finished image with a single composition');
  if (spec.requested_species === 'kangaroo') additions.push('unmistakable kangaroo anatomy with long upright ears, elongated muzzle, powerful hind legs and a large balancing tail');
  if (spec.requested_style === 'cartoon') additions.push('polished cartoon illustration');
  if (spec.requested_framing === 'close') additions.push('close framing with the subject filling most of the frame');
  if (spec.requested_framing === 'full_body') additions.push('full body completely inside the frame');
  if (spec.requested_pose) additions.push(spec.requested_pose);
  additions.push(...spec.requested_attributes.map(x => x + ' clearly visible'));
  const size = targetDimensions(original);
  if (size) additions.push(`${size.width}x${size.height}`);
  return original + (additions.length ? '. Nexa visual constraints: ' + additions.join(', ') + '.' : '');
}

function initialConstraints(plan, userRequest) {
  const spec = deriveVisualSpec(userRequest);
  const positive = [];
  const negative = [
    'character sheet', 'turnaround sheet', 'reference sheet', 'lineup',
    'multiple views', 'multiple poses', 'contact sheet', 'design sheet',
  ];

  if (spec.exact_subject_count === 1) {
    positive.push('exactly one main subject', 'single subject only', 'one pose only', 'single coherent composition');
    negative.push('second character', 'extra character', 'duplicate subject', 'cloned character', 'multiple characters');
  }
  if (spec.requested_species === 'kangaroo') {
    positive.push(
      'unmistakable kangaroo anatomy',
      'long upright kangaroo ears',
      'elongated kangaroo muzzle',
      'large muscular balancing kangaroo tail clearly visible',
      'powerful oversized kangaroo hind legs and feet',
      'shorter forearms relative to hind legs'
    );
    negative.push('bird beak','eagle head','human face','pig face','boar face','bear muzzle','short ears','missing tail','short tail','wrong animal');
  }
  if (spec.requested_style === 'cartoon') positive.push('polished cartoon illustration', 'clean appealing character design');
  if (spec.requested_framing === 'close') positive.push('close framing', 'tight single-subject composition', 'subject fills most of the frame');
  if (spec.requested_framing === 'full_body') positive.push('full body entirely visible', 'head to toe visible inside frame');
  if (spec.requested_pose) positive.push(spec.requested_pose, 'clear readable action silhouette');
  positive.push(...spec.requested_attributes.map(x => x + ' clearly visible'));

  const forcedSize = spec.requested_framing === 'close'
    ? { width:896, height:896 }
    : (spec.requested_framing === 'full_body' ? { width:768, height:1024 } : {});
  return {
    ...plan,
    ...forcedSize,
    positive_prompt: mergePrompt(sanitizePositiveBase(plan?.positive_prompt || plan?.positivePrompt), positive),
    negative_prompt: mergePrompt(plan?.negative_prompt || plan?.negativePrompt, negative),
    visual_spec: spec,
  };
}

function evaluationPrompt(userRequest, plan, attempt) {
  const spec = deriveVisualSpec(userRequest);
  return [
    'You are Nexa Visual Evaluator v1.8.1.',
    'Inspect the supplied generated image against the ORIGINAL USER REQUEST and VISUAL SPEC.',
    'Judge only what is visibly present. Never assume hidden details.',
    'Anthropomorphic animals ARE ALLOWED unless the user explicitly forbids them.',
    'Do not invent requirements that are not present in the user request.',
    'When exactly one subject is requested, a character sheet, lineup, repeated pose, duplicate, or second character is a failure.',
    'When kangaroo is requested, species_identity passes only if the image has unmistakable kangaroo anatomy, not merely a generic humanoid animal.',
    'requested_attributes covers explicit requested colors, clothing, props, and visible traits.',
    'pose_action evaluates the explicitly requested pose/action; use na when no pose/action was explicitly requested.',
    'framing must match an explicit close/full-body request when specified.',
    'Return JSON only and conform to the schema.',
    'Error codes: E001 wrong subject; E002 wrong subject count; E003 duplicate; E004 cropped head; E005 cropped feet; E006 cropped body; E007 wrong style; E008 wrong species; E009 anatomy problem; E010 missing requested attribute/object; E011 extra unrequested object; E012 cluttered background; E013 text artifact; E014 low quality; E015 wrong requested color; E016 wrong pose/action; E017 wrong framing; E018 character sheet/multiview.',
    '',
    'ATTEMPT: ' + Math.max(1, Number(attempt) || 1),
    'ORIGINAL USER REQUEST: ' + clean(userRequest, 6000),
    'VISUAL SPEC: ' + JSON.stringify(spec),
    'POSITIVE PROMPT USED: ' + clean(plan?.positive_prompt || plan?.positivePrompt, 9000),
    'NEGATIVE PROMPT USED: ' + clean(plan?.negative_prompt || plan?.negativePrompt, 7000),
    'SIZE: ' + Number(plan?.width || 0) + 'x' + Number(plan?.height || 0),
  ].join('\n');
}

function status(value) {
  const v = String(value || '').toLowerCase();
  return ['pass','fail','uncertain','na'].includes(v) ? v : 'uncertain';
}

function normalizeEvaluation(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of Object.keys(CHECK_WEIGHTS)) out[key] = status(src[key]);
  out.detected_subject_count = Math.max(0, Math.min(20, Number(src.detected_subject_count) || 0));
  out.detected_subject = clean(src.detected_subject, 200);
  out.detected_species = clean(src.detected_species, 200);
  out.confidence = Math.max(0, Math.min(1, Number(src.confidence) || 0));
  out.error_codes = unique(src.error_codes, 18).map(x => x.toUpperCase()).filter(x => ALLOWED_CODES.has(x));
  out.problems = unique(src.problems, 12);
  out.repair_positive = unique(src.repair_positive, 14);
  out.repair_negative = unique(src.repair_negative, 14);
  return out;
}

function finalizeEvaluation(raw, userRequest, threshold = THRESHOLD) {
  const spec = deriveVisualSpec(userRequest);
  const out = normalizeEvaluation(raw);
  const codes = new Set(out.error_codes);

  if (out.subject_identity === 'fail' || out.subject_identity === 'uncertain') codes.add('E001');
  if (spec.exact_subject_count !== null) {
    if (out.detected_subject_count !== spec.exact_subject_count || out.subject_count !== 'pass') codes.add('E002');
    if (out.detected_subject_count > spec.exact_subject_count) codes.add('E003');
  }
  if (spec.requested_species && out.species_identity !== 'pass') codes.add('E008');
  if (spec.requested_style && out.style !== 'pass') codes.add('E007');
  if (spec.requested_framing && out.framing !== 'pass') codes.add('E017');
  if (spec.requested_attributes.length && out.requested_attributes !== 'pass') codes.add('E010');
  if (spec.requested_pose && out.pose_action !== 'pass') codes.add('E016');
  if (out.anatomy === 'fail') codes.add('E009');
  if (out.background === 'fail') codes.add('E012');
  if (out.text_integrity === 'fail') codes.add('E013');
  if (out.technical_quality === 'fail') codes.add('E014');

  const problemsText = out.problems.join(' ').toLowerCase();
  if (/character sheet|turnaround|reference sheet|lineup|multiple views|multiple poses|repeated poses/.test(problemsText)) codes.add('E018');

  let earned = 0;
  let possible = 0;
  for (const [key, weight] of Object.entries(CHECK_WEIGHTS)) {
    const v = out[key];
    if (v === 'na') continue;
    possible += weight;
    if (v === 'pass') earned += weight;
    else if (v === 'uncertain') earned += weight * 0.35;
  }
  const score = possible ? Math.round((earned / possible) * 100) : 0;
  const error_codes = [...codes].filter(x => ALLOWED_CODES.has(x));
  const critical_errors = error_codes.filter(x => CRITICAL_ERRORS.has(x));
  const safeThreshold = Math.max(60, Math.min(100, Number(threshold) || THRESHOLD));
  return {
    ...out,
    error_codes,
    score,
    threshold:safeThreshold,
    critical_errors,
    critical:critical_errors.length > 0,
    pass:score >= safeThreshold && critical_errors.length === 0,
    visual_spec:spec,
  };
}

const REPAIRS = Object.freeze({
  E001:{ p:['unmistakable requested main subject','preserve exact requested identity'], n:['wrong subject','unrelated subject'] },
  E002:{ p:['exact requested subject count','single clear composition','no additional subjects'], n:['extra subject','multiple characters','second character','character sheet','lineup','multiple views','multiple poses'] },
  E003:{ p:['single isolated subject','one pose only','one character only'], n:['duplicate subject','cloned subject','second character','multiple copies','turnaround sheet','reference sheet'] },
  E007:{ p:['strictly preserve the explicitly requested visual style'], n:['wrong style','style drift','mixed styles'] },
  E008:{ p:['unmistakable requested species identity','species-defining anatomy and silhouette clearly visible'], n:['wrong species','hybrid species','ambiguous animal identity'] },
  E009:{ p:['coherent anatomy','correct limb structure','clean natural proportions'], n:['extra limbs','missing limbs','deformed anatomy','fused limbs','malformed body'] },
  E010:{ p:['all explicitly requested objects, colors and attributes clearly visible'], n:['missing requested object','missing requested attribute'] },
  E011:{ p:['only requested subjects and objects'], n:['extra object','unrequested character','unrequested subject'] },
  E012:{ p:['clean controlled background'], n:['cluttered background','busy background','messy background'] },
  E013:{ p:['no accidental text'], n:['garbled text','random letters','watermark','signature'] },
  E014:{ p:['sharp clean professional image','polished finish'], n:['blurry','low quality','pixelated','muddy details','unfinished'] },
  E015:{ p:['strictly preserve explicitly requested colors'], n:['wrong requested color','incorrect color assignment'] },
  E016:{ p:['strictly preserve requested pose and action','clear readable action'], n:['wrong pose','wrong action','static pose'] },
  E017:{ p:['strictly match requested framing and camera distance'], n:['wrong framing','wrong camera distance','unrequested wide shot'] },
  E018:{ p:['one subject only','one pose only','single scene composition'], n:['character sheet','turnaround sheet','reference sheet','design sheet','lineup','multiple views','multiple poses','contact sheet'] },
});

function applyRepairs(plan, evaluation, userRequest, nextAttempt) {
  const positive = [];
  const negative = [];
  const spec = deriveVisualSpec(userRequest);
  for (const code of evaluation?.error_codes || []) {
    const repair = REPAIRS[code];
    if (repair) { positive.push(...repair.p); negative.push(...repair.n); }
  }
  positive.push(...(evaluation?.repair_positive || []));
  negative.push(...(evaluation?.repair_negative || []));

  if ((evaluation?.error_codes || []).includes('E008') && spec.requested_species === 'kangaroo') {
    positive.push(
      'unmistakable kangaroo anatomy', 'long upright kangaroo ears', 'elongated kangaroo muzzle',
      'very large muscular balancing kangaroo tail clearly visible', 'powerful oversized kangaroo hind legs and feet',
      'shorter forearms relative to hind legs'
    );
    negative.push('bird beak','eagle head','human face','pig face','boar face','bear muzzle','short ears','missing tail','short tail','wrong animal');
  }
  if (Number(nextAttempt) >= 3) {
    positive.unshift('strict compliance with every explicit user requirement','one coherent finished image, not a design sheet');
    negative.unshift('request drift','ambiguous subject identity','character sheet','multiple poses','multiple subjects');
  }

  return {
    ...plan,
    positive_prompt:mergePrompt(plan?.positive_prompt || plan?.positivePrompt, positive),
    negative_prompt:mergePrompt(plan?.negative_prompt || plan?.negativePrompt, negative),
    repairCodes:[...(evaluation?.error_codes || [])],
  };
}

function bestAttempt(attempts) {
  const rows = (Array.isArray(attempts) ? attempts : []).filter(x => x && x.image && x.evaluation);
  if (!rows.length) return null;
  return rows.slice().sort((a,b) => {
    const pass = Number(Boolean(b.evaluation.pass)) - Number(Boolean(a.evaluation.pass));
    if (pass) return pass;
    const crit = Number(a.evaluation.critical_errors?.length || 0) - Number(b.evaluation.critical_errors?.length || 0);
    if (crit) return crit;
    const score = Number(b.evaluation.score || 0) - Number(a.evaluation.score || 0);
    if (score) return score;
    return Number(a.attempt || 0) - Number(b.attempt || 0);
  })[0];
}

function summary(evaluation, attempts) {
  if (!evaluation) return 'Nexa Visual: sin evaluación.';
  const state = evaluation.pass ? 'APROBADA' : 'MEJOR RESULTADO NO APROBADO';
  const errors = evaluation.error_codes?.length ? ' · ' + evaluation.error_codes.join(', ') : '';
  return `Nexa Visual ${state} · ${evaluation.score}/100 · ${attempts} intento${attempts === 1 ? '' : 's'}${errors}`;
}

module.exports = {
  MODEL,
  THRESHOLD,
  MAX_ATTEMPTS,
  SCHEMA,
  CRITICAL_ERRORS,
  deriveVisualSpec,
  initialConstraints,
  evaluationPrompt,
  finalizeEvaluation,
  applyRepairs,
  bestAttempt,
  summary,
  targetDimensions,
  augmentInitialRequest,
};
