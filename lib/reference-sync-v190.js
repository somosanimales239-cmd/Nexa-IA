'use strict';

function mergeChatImagesIntoReferenceConfig(referenceConfig, routed) {
  const cfg = {
    enabled: false,
    mode: 'consistency',
    images: [],
    strength: 75,
    identityWeight: 85,
    styleWeight: 65,
    compositionWeight: 45,
    useInRetries: true,
    carryBestApprovedAnchor: true,
    source: 'chat',
    ...(referenceConfig || {}),
  };

  if (!routed || !routed.useReferenceImages || !Array.isArray(routed.referenceImages) || !routed.referenceImages.length) {
    return cfg;
  }

  return {
    ...cfg,
    enabled: true,
    images: routed.referenceImages.map((x) => x.path).slice(0, 6),
  };
}

module.exports = {
  mergeChatImagesIntoReferenceConfig,
};
