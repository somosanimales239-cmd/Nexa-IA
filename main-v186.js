'use strict';

// Entry wrapper for Nexa AI v1.8.6
// Goal: preserve existing generation flow, but use soft visual review decisioning
// and support optional reference images for likeness/consistency.

const { buildDecision } = require('./lib/visual-review-v186');
const { normalizeReferenceConfig, mergeReferenceHintsIntoPrompt } = require('./lib/reference-consistency-v186');

module.exports = {
  version: '1.8.6',
  description: 'Soft Review + Reference Consistency',
  buildDecision,
  normalizeReferenceConfig,
  mergeReferenceHintsIntoPrompt,
};
