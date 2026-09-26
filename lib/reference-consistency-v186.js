'use strict';

const MAX_REFERENCES = 6;

function sanitizeNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeReferenceConfig(input = {}) {
  const refs = Array.isArray(input.images) ? input.images.filter(Boolean).slice(0, MAX_REFERENCES) : [];
  return {
    enabled: !!input.enabled && refs.length > 0,
    mode: String(input.mode || 'consistency').toLowerCase(),
    images: refs,
    strength: sanitizeNumber(input.strength, 65, 0, 100),
    identityWeight: sanitizeNumber(input.identityWeight, 80, 0, 100),
    styleWeight: sanitizeNumber(input.styleWeight, 60, 0, 100),
    compositionWeight: sanitizeNumber(input.compositionWeight, 50, 0, 100),
    useInRetries: input.useInRetries !== false,
    carryBestApprovedAnchor: input.carryBestApprovedAnchor !== false,
    maxReferences: MAX_REFERENCES,
  };
}

function buildReferencePromptHints(config) {
  if (!config || !config.enabled || !config.images.length) return [];
  const hints = [];
  const mode = config.mode;

  if (mode === 'likeness') {
    hints.push('match the main subject to the uploaded reference images with strong likeness');
    hints.push(`identity consistency priority ${config.identityWeight}/100`);
  } else if (mode === 'style') {
    hints.push('follow the visual style and rendering language of the uploaded reference images');
    hints.push(`style influence ${config.styleWeight}/100`);
  } else if (mode === 'composition') {
    hints.push('use the uploaded reference images as composition guidance only');
    hints.push(`composition influence ${config.compositionWeight}/100`);
  } else if (mode === 'product') {
    hints.push('preserve product identity and recognizable details from the uploaded reference images');
  } else {
    hints.push('maintain consistency with the uploaded reference images across subject, style and design');
  }

  hints.push(`overall reference strength ${config.strength}/100`);
  if (config.useInRetries) hints.push('apply the same reference guidance during retries');
  if (config.carryBestApprovedAnchor) hints.push('if a good attempt is produced, use it as an anchor for future consistency');
  return hints;
}

function mergeReferenceHintsIntoPrompt(prompt, config) {
  const hints = buildReferencePromptHints(config);
  if (!hints.length) return prompt;
  return `${prompt}\n\nReference guidance:\n- ${hints.join('\n- ')}`;
}

module.exports = {
  MAX_REFERENCES,
  normalizeReferenceConfig,
  buildReferencePromptHints,
  mergeReferenceHintsIntoPrompt,
};
