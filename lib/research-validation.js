'use strict';

const ALLOWED_STATUSES = new Set(['VERIFIED','PARTIAL','CONFLICTING','OUTDATED','NOT VERIFIED']);
const ARRAY_FIELDS = new Set(['FACTS','PROCEDURES','SPECIFICATIONS','WARNINGS','RELATED_TOPICS']);

function clampConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function cleanText(value) {
  return String(value == null ? '' : value).replace(/\r\n/g, '\n').trim();
}

function stripFence(value) {
  let text = cleanText(value);
  if (text.startsWith('```')) {
    const firstBreak = text.indexOf('\n');
    if (firstBreak >= 0) text = text.slice(firstBreak + 1);
    const lastFence = text.lastIndexOf('```');
    if (lastFence >= 0) text = text.slice(0, lastFence);
  }
  return text.trim();
}

function extractJsonObject(value) {
  const raw = stripFence(value);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) {}
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(raw.slice(first, last + 1)); } catch (_) {}
  }
  return null;
}

function splitCsvNumbers(value) {
  return String(value || '')
    .split(/[,;\s]+/)
    .map(item => Number(item))
    .filter(item => Number.isInteger(item) && item > 0);
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
  const text = cleanText(value);
  if (!text) return [];
  return text.split('\n').map(line => line.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
}

function normalizeValidationObject(input, defaults = {}) {
  if (!input || typeof input !== 'object') return null;
  let status = String(input.verification_status || input.status || 'NOT VERIFIED').trim().toUpperCase().replace(/_/g, ' ');
  if (status === 'NOTVERIFIED') status = 'NOT VERIFIED';
  if (!ALLOWED_STATUSES.has(status)) status = 'NOT VERIFIED';
  const content = input.content && typeof input.content === 'object' ? input.content : {};
  const summary = cleanText(input.summary || content.description || input.description || '');
  return {
    verification_status: status,
    confidence: clampConfidence(input.confidence),
    system: cleanText(input.system || defaults.system || ''),
    subsystem: cleanText(input.subsystem || ''),
    topic: cleanText(input.topic || defaults.topic || ''),
    summary,
    content: {
      description: cleanText(content.description || input.description || summary),
      facts: normalizeArray(content.facts || input.facts),
      procedures: normalizeArray(content.procedures || input.procedures),
      specifications: normalizeArray(content.specifications || input.specifications),
      warnings: normalizeArray(content.warnings || input.warnings),
      related_topics: normalizeArray(content.related_topics || input.related_topics),
    },
    applicable_years: cleanText(input.applicable_years || ''),
    engine: cleanText(input.engine || ''),
    transmission: cleanText(input.transmission || ''),
    market: cleanText(input.market || ''),
    source_indexes: Array.isArray(input.source_indexes)
      ? input.source_indexes.map(item => Number(item)).filter(item => Number.isInteger(item) && item > 0)
      : splitCsvNumbers(input.source_indexes),
    reason: cleanText(input.reason || ''),
    parser: 'json',
  };
}

function parseTaggedProtocol(value, defaults = {}) {
  const raw = stripFence(value);
  if (!raw) return null;
  const lines = raw.split('\n');
  const scalar = {};
  const arrays = {};
  let current = '';
  const known = new Set([
    'STATUS','VERIFICATION_STATUS','CONFIDENCE','SYSTEM','SUBSYSTEM','TOPIC','SUMMARY','DESCRIPTION',
    'APPLICABLE_YEARS','ENGINE','TRANSMISSION','MARKET','SOURCE_INDEXES','REASON',
    'FACTS','PROCEDURES','SPECIFICATIONS','WARNINGS','RELATED_TOPICS',
  ]);

  for (const original of lines) {
    const line = String(original || '');
    const match = line.match(/^\s*([A-Z_]+)\s*:\s*(.*)$/);
    if (match && known.has(match[1])) {
      current = match[1];
      const rest = match[2].trim();
      if (ARRAY_FIELDS.has(current)) {
        arrays[current] = arrays[current] || [];
        if (rest) arrays[current].push(rest.replace(/^[-*•]\s*/, '').trim());
      } else {
        scalar[current] = rest;
      }
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed || /^NEXA_VALIDATION/i.test(trimmed) || /^END_NEXA_VALIDATION/i.test(trimmed)) continue;
    if (ARRAY_FIELDS.has(current)) {
      arrays[current] = arrays[current] || [];
      arrays[current].push(trimmed.replace(/^[-*•]\s*/, '').trim());
    } else if (current) {
      scalar[current] = (scalar[current] ? scalar[current] + '\n' : '') + trimmed;
    }
  }

  if (!scalar.STATUS && !scalar.VERIFICATION_STATUS && !scalar.SUMMARY && !scalar.DESCRIPTION) return null;
  const normalized = normalizeValidationObject({
    verification_status: scalar.STATUS || scalar.VERIFICATION_STATUS,
    confidence: scalar.CONFIDENCE,
    system: scalar.SYSTEM,
    subsystem: scalar.SUBSYSTEM,
    topic: scalar.TOPIC,
    summary: scalar.SUMMARY,
    content: {
      description: scalar.DESCRIPTION || scalar.SUMMARY,
      facts: arrays.FACTS || [],
      procedures: arrays.PROCEDURES || [],
      specifications: arrays.SPECIFICATIONS || [],
      warnings: arrays.WARNINGS || [],
      related_topics: arrays.RELATED_TOPICS || [],
    },
    applicable_years: scalar.APPLICABLE_YEARS,
    engine: scalar.ENGINE,
    transmission: scalar.TRANSMISSION,
    market: scalar.MARKET,
    source_indexes: splitCsvNumbers(scalar.SOURCE_INDEXES),
    reason: scalar.REASON,
  }, defaults);
  if (!normalized) return null;
  normalized.parser = 'tagged';
  return normalized;
}

function parseResearchValidation(value, defaults = {}) {
  const json = extractJsonObject(value);
  if (json) return normalizeValidationObject(json, defaults);
  return parseTaggedProtocol(value, defaults);
}

function protocolInstructions() {
  return [
    'Return the final answer using this plain-text protocol. Do NOT use markdown fences.',
    'NEXA_VALIDATION_V1',
    'STATUS: VERIFIED|PARTIAL|CONFLICTING|OUTDATED|NOT VERIFIED',
    'CONFIDENCE: 0.00 to 1.00',
    'SYSTEM: short system name',
    'SUBSYSTEM: short subsystem name or blank',
    'TOPIC: exact topic',
    'SUMMARY: concise factual summary grounded only in supplied sources',
    'DESCRIPTION: concise description',
    'FACTS:',
    '- one factual item per line',
    'PROCEDURES:',
    '- one procedure item per line',
    'SPECIFICATIONS:',
    '- one specification item per line',
    'WARNINGS:',
    '- one warning per line',
    'RELATED_TOPICS:',
    '- one related topic per line',
    'APPLICABLE_YEARS: exact years or blank',
    'ENGINE: exact engine or blank',
    'TRANSMISSION: exact transmission or blank',
    'MARKET: exact market or blank',
    'SOURCE_INDEXES: comma-separated source numbers actually used',
    'REASON: why this verification status was selected',
    'END_NEXA_VALIDATION',
  ].join('\n');
}

function safePartialFromText(value, defaults = {}) {
  const text = stripFence(value).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const clipped = text.slice(0, 1800);
  return {
    verification_status: 'PARTIAL',
    confidence: 0.5,
    system: cleanText(defaults.system || ''),
    subsystem: '',
    topic: cleanText(defaults.topic || ''),
    summary: clipped,
    content: { description: clipped, facts:[], procedures:[], specifications:[], warnings:[], related_topics:[] },
    applicable_years: '', engine:'', transmission:'', market:'', source_indexes:[],
    reason: 'La respuesta del modelo fue utilizable como texto pero no siguió el protocolo estructurado; se conserva solamente como PARTIAL.',
    parser: 'safe-text-fallback',
  };
}

module.exports = {
  extractJsonObject,
  normalizeValidationObject,
  parseTaggedProtocol,
  parseResearchValidation,
  protocolInstructions,
  safePartialFromText,
};
