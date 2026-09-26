'use strict';

const DEFAULTS = {
  visualAcceptThreshold: 78,
  visualGreatThreshold: 88,
  uncertainWeight: 0.72,
  softFailWeight: 0.40,
  hardFailWeight: 0.0,
};

const HARD_ERROR_MAP = {
  subject_identity: 'E001',
  subject_count: 'E002',
  duplicate_subject: 'E003',
  species_identity: 'E008',
  required_attribute_missing: 'E010',
  anatomy: 'E009',
};

const SOFT_ERROR_MAP = {
  style: 'E007',
  pose_action: 'E016',
  framing: 'E017',
  background: 'E012',
  expression: 'E018',
  technical_quality: 'E014',
};

const CHECK_WEIGHTS = {
  subject_identity: 20,
  subject_count: 12,
  duplicate_subject: 10,
  species_identity: 14,
  required_attribute_missing: 10,
  anatomy: 10,
  style: 7,
  pose_action: 5,
  framing: 5,
  background: 3,
  expression: 2,
  technical_quality: 2,
};

function normalizedState(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'pass' || v === 'true') return 'pass';
  if (v === 'fail' || v === 'false') return 'fail';
  if (v === 'na' || v === 'n/a' || v === 'skip') return 'na';
  return 'uncertain';
}

function scoreState(state, weight, cfg) {
  if (state === 'na') return { points: weight, counted: false };
  if (state === 'pass') return { points: weight, counted: true };
  if (state === 'fail') return { points: Math.round(weight * cfg.softFailWeight), counted: true };
  return { points: Math.round(weight * cfg.uncertainWeight), counted: true };
}

function classifyFailure(key, state) {
  if (state !== 'fail') return null;
  if (HARD_ERROR_MAP[key]) return { code: HARD_ERROR_MAP[key], severity: 'hard', key };
  if (SOFT_ERROR_MAP[key]) return { code: SOFT_ERROR_MAP[key], severity: 'soft', key };
  return null;
}

function buildDecision(review, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const result = review || {};

  const states = {
    subject_identity: normalizedState(result.subject_identity),
    subject_count: normalizedState(result.subject_count),
    duplicate_subject: normalizedState(result.duplicate_subject),
    species_identity: normalizedState(result.species_identity),
    required_attribute_missing: normalizedState(result.required_attribute_missing),
    anatomy: normalizedState(result.anatomy),
    style: normalizedState(result.style),
    pose_action: normalizedState(result.pose_action),
    framing: normalizedState(result.framing),
    background: normalizedState(result.background),
    expression: normalizedState(result.expression),
    technical_quality: normalizedState(result.technical_quality),
  };

  let total = 0;
  let earned = 0;
  const failures = [];

  for (const [key, weight] of Object.entries(CHECK_WEIGHTS)) {
    total += weight;
    const s = scoreState(states[key], weight, cfg);
    earned += s.points;
    const failure = classifyFailure(key, states[key]);
    if (failure) failures.push(failure);
  }

  const hardFailures = failures.filter((f) => f.severity === 'hard');
  const softFailures = failures.filter((f) => f.severity === 'soft');
  const score = Math.max(0, Math.min(100, Math.round((earned / total) * 100)));

  const accepted = hardFailures.length === 0 && score >= cfg.visualAcceptThreshold;
  const retryRecommended = hardFailures.length > 0 || score < cfg.visualAcceptThreshold;
  const qualityBand = score >= cfg.visualGreatThreshold ? 'great' : score >= cfg.visualAcceptThreshold ? 'good' : score >= 65 ? 'usable' : 'poor';

  return {
    accepted,
    retryRecommended,
    score,
    qualityBand,
    hardFailures,
    softFailures,
    failures,
    states,
    threshold: cfg.visualAcceptThreshold,
  };
}

module.exports = {
  buildDecision,
  DEFAULTS,
};
