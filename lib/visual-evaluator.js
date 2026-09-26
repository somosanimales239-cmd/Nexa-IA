'use strict';

const DEFAULT_VISUAL_EVALUATOR_MODEL = 'qwen2.5vl:3b';

const CHECK_WEIGHTS = Object.freeze({
  subject_identity: 23,
  subject_count: 14,
  species_identity: 14,
  framing: 13,
  style: 10,
  requested_attributes: 10,
  anatomy: 7,
  background: 3,
  text_integrity: 3,
  technical_quality: 3,
});

const CRITICAL_ERRORS = new Set([
  'E001', // wrong subject
  'E002', // wrong count
  'E003', // duplicate subject
  'E008', // wrong species
]);

const ALLOWED_CODES = new Set([
  'E001','E002','E003','E004','E005','E006','E007','E008',
  'E009','E010','E011','E012','E013','E014','E015','E016',
]);

const ERROR_REPAIRS = Object.freeze({
  E001: {
    positive: ['unmistakable requested main subject', 'preserve the exact requested subject identity'],
    negative: ['wrong subject', 'unrelated subject'],
  },
  E002: {
    positive: ['exact requested subject count', 'no additional subjects'],
    negative: ['wrong number of subjects', 'extra subject'],
  },
  E003: {
    positive: ['exactly one requested subject when one subject was requested', 'single isolated subject', 'no duplicated character'],
    negative: ['duplicate subject', 'cloned subject', 'second character', 'multiple copies'],
  },
  E004: {
    positive: ['entire head fully visible', 'comfortable headroom inside the frame'],
    negative: ['cropped head', 'head outside frame'],
  },
  E005: {
    positive: ['full body entirely visible', 'both feet completely visible', 'camera pulled back', 'generous space around the subject'],
    negative: ['cropped feet', 'cropped legs', 'feet outside frame'],
  },
  E006: {
    positive: ['entire requested subject fully inside the frame', 'complete silhouette visible', 'camera pulled back'],
    negative: ['cropped body', 'body outside frame', 'cut off subject'],
  },
  E007: {
    positive: ['strictly preserve the requested visual style', 'consistent requested rendering style'],
    negative: ['wrong style', 'mixed visual styles', 'style drift'],
  },
  E008: {
    positive: ['unmistakable requested species identity', 'species-defining anatomy must be clearly visible'],
    negative: ['wrong species', 'hybrid species', 'ambiguous animal identity'],
  },
  E009: {
    positive: ['coherent anatomy', 'correct limb structure', 'clean natural body proportions'],
    negative: ['extra limbs', 'missing limbs', 'deformed anatomy', 'malformed body', 'fused limbs'],
  },
  E010: {
    positive: ['all explicitly requested objects and attributes must be clearly visible'],
    negative: ['missing requested object', 'missing requested attribute'],
  },
  E011: {
    positive: ['only requested subjects and objects', 'clean controlled composition'],
    negative: ['unrequested object', 'extra object', 'unrequested character'],
  },
  E012: {
    positive: ['clean uncluttered background', 'background supports the subject without distraction'],
    negative: ['busy background', 'cluttered background', 'messy background'],
  },
  E013: {
    positive: ['no accidental text unless explicitly requested'],
    negative: ['garbled text', 'random letters', 'watermark', 'signature', 'text artifact'],
  },
  E014: {
    positive: ['sharp clean professional image', 'high detail', 'clean edges', 'polished finish'],
    negative: ['blurry', 'low quality', 'pixelated', 'muddy details', 'unfinished'],
  },
  E015: {
    positive: ['strictly preserve explicitly requested colors'],
    negative: ['wrong requested color', 'incorrect color assignment'],
  },
  E016: {
    positive: ['strictly preserve the requested pose and action', 'clear readable action silhouette'],
    negative: ['wrong pose', 'wrong action', 'static pose when action was requested'],
  },
});

const VISUAL_EVALUATION_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    subject_identity: { type: 'string', enum: ['pass','fail','uncertain','na'] },
    subject_count: { type: 'string', enum: ['pass','fail','uncertain','na'] },
    species_identity: { type: 'string', enum: ['pass','fail','uncertain','na'] },
    framing: { type: 'string', enum: ['pass','fail','uncertain','na'] },
    style: { type: 'string', enum: ['pass','fail','uncertain','na'] },
    requested_attributes: { type: 'string', enum: ['pass','fail','uncertain','na'] },
    anatomy: { type: 'string', enum: ['pass','fail','uncertain','na'] },
    background: { type: 'string', enum: ['pass','fail','uncertain','na'] },
    text_integrity: { type: 'string', enum: ['pass','fail','uncertain','na'] },
    technical_quality: { type: 'string', enum: ['pass','fail','uncertain','na'] },
    detected_subject_count: { type: 'integer', minimum: 0, maximum: 20 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    error_codes: {
      type: 'array',
      items: { type: 'string', enum: [...ALLOWED_CODES] },
      maxItems: 16,
    },
    problems: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    repair_positive: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    repair_negative: { type: 'array', items: { type: 'string' }, maxItems: 12 },
  },
  required: [
    'subject_identity','subject_count','species_identity','framing','style',
    'requested_attributes','anatomy','background','text_integrity','technical_quality',
    'detected_subject_count','confidence','error_codes','problems','repair_positive','repair_negative',
  ],
  additionalProperties: false,
});

function compact(value, max = 6000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function uniqueText(values, maxItems = 24) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const value = compact(raw, 240);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= maxItems) break;
  }
  return out;
}

function mergePrompt(base, additions) {
  const first = compact(base, 12000);
  const extra = uniqueText(additions, 30);
  if (!extra.length) return first;
  return first ? `${first}, ${extra.join(', ')}` : extra.join(', ');
}

function buildEvaluationPrompt({ userRequest, plan, attempt = 1 }) {
  return [
    'You are Nexa Visual Evaluator v1. Inspect the generated image against the ORIGINAL USER REQUEST.',
    'Judge only what is visibly present. Do not assume hidden details. Be strict but not speculative.',
    'The original request is the source of truth. The generation plan is supporting context only.',
    'Use species_identity=na when the subject is not an animal/species. Use text_integrity=na when no text was requested and no accidental text is visible.',
    'Use error codes only when the problem is actually visible:',
    'E001 wrong subject; E002 wrong subject count; E003 duplicate subject; E004 cropped head; E005 cropped feet; E006 cropped body; E007 wrong style; E008 wrong species; E009 anatomy problem; E010 missing requested object/attribute; E011 extra unrequested object; E012 background too complex; E013 text artifact; E014 low image quality; E015 wrong requested color; E016 wrong pose/action.',
    'repair_positive and repair_negative must contain short image-prompt phrases that directly address visible failures. Return no prose outside the required JSON.',
    '',
    `ATTEMPT: ${Math.max(1, Number(attempt) || 1)}`,
    `ORIGINAL USER REQUEST: ${compact(userRequest, 5000)}`,
    `EXPECTED STYLE: ${compact(plan?.style, 120) || 'unspecified'}`,
    `POSITIVE PROMPT USED: ${compact(plan?.positive_prompt || plan?.positivePrompt, 7000)}`,
    `NEGATIVE PROMPT USED: ${compact(plan?.negative_prompt || plan?.negativePrompt, 5000)}`,
    `EXPECTED SIZE: ${Number(plan?.width || 0)}x${Number(plan?.height || 0)}`,
  ].join('\n');
}

function normalizeStatus(value) {
  const raw = String(value || '').toLowerCase();
  return ['pass','fail','uncertain','na'].includes(raw) ? raw : 'uncertain';
}

function normalizeEvaluation(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const checks = {};
  for (const key of Object.keys(CHECK_WEIGHTS)) checks[key] = normalizeStatus(source[key]);
  const errorCodes = uniqueText(source.error_codes, 16).map(code => code.toUpperCase()).filter(code => ALLOWED_CODES.has(code));
  return {
    ...checks,
    detected_subject_count: Math.max(0, Math.min(20, Number(source.detected_subject_count) || 0)),
    confidence: Math.max(0, Math.min(1, Number(source.confidence) || 0)),
    error_codes: [...new Set(errorCodes)],
    problems: uniqueText(source.problems, 12),
    repair_positive: uniqueText(source.repair_positive, 12),
    repair_negative: uniqueText(source.repair_negative, 12),
  };
}

function scoreEvaluation(evaluation, threshold = 86) {
  const normalized = normalizeEvaluation(evaluation);
  let earned = 0;
  let possible = 0;
  for (const [key, weight] of Object.entries(CHECK_WEIGHTS)) {
    const status = normalized[key];
    if (status === 'na') continue;
    possible += weight;
    if (status === 'pass') earned += weight;
    else if (status === 'uncertain') earned += weight * 0.5;
  }
  const score = possible > 0 ? Math.round((earned / possible) * 100) : 0;
  const criticalErrors = normalized.error_codes.filter(code => CRITICAL_ERRORS.has(code));
  const safeThreshold = Math.max(50, Math.min(100, Number(threshold) || 86));
  const pass = score >= safeThreshold && criticalErrors.length === 0;
  return {
    ...normalized,
    score,
    threshold: safeThreshold,
    pass,
    critical: criticalErrors.length > 0,
    critical_errors: criticalErrors,
  };
}

function applyRepairs(plan, evaluation, attempt = 2) {
  const result = scoreEvaluation(evaluation, evaluation?.threshold || 86);
  const positive = [];
  const negative = [];
  for (const code of result.error_codes) {
    const repair = ERROR_REPAIRS[code];
    if (!repair) continue;
    positive.push(...repair.positive);
    negative.push(...repair.negative);
  }
  positive.push(...result.repair_positive);
  negative.push(...result.repair_negative);

  // Attempt 3 is intentionally stronger without changing the user's requested subject.
  if (Number(attempt) >= 3) {
    positive.unshift('strict compliance with the original request', 'all mandatory requested details clearly visible');
    negative.unshift('request drift', 'ambiguous subject identity');
  }

  return {
    ...plan,
    positive_prompt: mergePrompt(plan?.positive_prompt || plan?.positivePrompt, positive),
    negative_prompt: mergePrompt(plan?.negative_prompt || plan?.negativePrompt, negative),
    repairCodes: result.error_codes.slice(),
  };
}

function shouldRetry(evaluation, threshold = 86) {
  const scored = scoreEvaluation(evaluation, threshold);
  return { retry: !scored.pass, evaluation: scored };
}

function bestAttempt(attempts) {
  const usable = (Array.isArray(attempts) ? attempts : []).filter(item => item && item.image && Number.isFinite(Number(item.evaluation?.score)));
  if (!usable.length) return null;
  return usable.slice().sort((a, b) => {
    const passDiff = Number(Boolean(b.evaluation?.pass)) - Number(Boolean(a.evaluation?.pass));
    if (passDiff) return passDiff;
    const scoreDiff = Number(b.evaluation?.score || 0) - Number(a.evaluation?.score || 0);
    if (scoreDiff) return scoreDiff;
    return Number(a.attempt || 0) - Number(b.attempt || 0);
  })[0];
}

function evaluationSummary(evaluation, attempts = 1) {
  if (!evaluation) return 'Nexa Visual Evaluator no disponible; se conservó el resultado de ComfyUI.';
  const status = evaluation.pass ? 'aprobada' : 'mejor resultado disponible';
  const errors = Array.isArray(evaluation.error_codes) && evaluation.error_codes.length ? ` · ${evaluation.error_codes.join(', ')}` : '';
  return `Nexa Visual: ${status} ${evaluation.score}/100 · ${attempts} intento${attempts === 1 ? '' : 's'}${errors}`;
}

module.exports = {
  DEFAULT_VISUAL_EVALUATOR_MODEL,
  CHECK_WEIGHTS,
  CRITICAL_ERRORS,
  ERROR_REPAIRS,
  VISUAL_EVALUATION_SCHEMA,
  buildEvaluationPrompt,
  normalizeEvaluation,
  scoreEvaluation,
  applyRepairs,
  shouldRetry,
  bestAttempt,
  evaluationSummary,
};
