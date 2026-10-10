'use strict';

const REFERENCE_PATTERNS = [
  /parecid/i,
  /similar/i,
  /same\s+(dog|puppy|cat|character|style|person)/i,
  /mismo\s+(perrito|perro|gato|personaje|estilo)/i,
  /usa\s+esta\s+imagen/i,
  /reference/i,
  /consisten/i,
  /igual\s+a/i,
];

const VISUAL_QUESTION_PATTERNS = [
  /describe/i,
  /que\s+ves/i,
  /what\s+do\s+you\s+see/i,
  /compare/i,
  /count/i,
  /leer/i,
  /read\s+the\s+text/i,
];

function wantsReferenceMode(text) {
  const t = String(text || '');
  return REFERENCE_PATTERNS.some((rx) => rx.test(t));
}

function wantsVisionQuestion(text) {
  const t = String(text || '');
  return VISUAL_QUESTION_PATTERNS.some((rx) => rx.test(t));
}

function routeMessage(messageText, attachments = []) {
  const images = attachments.filter((a) => a.type === 'image');
  const documents = attachments.filter((a) => a.type === 'document');
  return {
    hasImages: images.length > 0,
    hasDocuments: documents.length > 0,
    useReferenceImages: images.length > 0 && wantsReferenceMode(messageText),
    useVisionQa: images.length > 0 && wantsVisionQuestion(messageText),
    referenceImages: images,
    documents,
  };
}

module.exports = {
  wantsReferenceMode,
  wantsVisionQuestion,
  routeMessage,
};
