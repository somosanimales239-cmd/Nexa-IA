'use strict';

function text(value){ return String(value || '').trim(); }

function wantsReference(value) {
  const source = text(value);
  return /(mismo|misma|same|parecid|similar|referencia|reference|consisten|igual\s+a|usa\s+esta\s+(imagen|foto)|use\s+this\s+image|mismo\s+estilo|same\s+style|basad[oa]\s+en|based\s+on|a\s+partir\s+de|con\s+esta\s+(imagen|foto)|como\s+esta\s+(imagen|foto)|mant[eé]n|manteniendo|conserva|preserva|identidad|este\s+(perro|perrito|gato|personaje)|esta\s+(perrita|gata|imagen|foto)|this\s+(dog|puppy|cat|character|image|photo)|el\s+de\s+la\s+(foto|imagen)|la\s+de\s+la\s+(foto|imagen))/i.test(source);
}

function looksLikeExplicitImageRequest(value) {
  const source = text(value);
  if (!source) return false;
  if (/^\/(image|img)\b/i.test(source)) return true;
  return /(genera|generame|generate|create|crear|crea|haz|hazme|make|draw|render|dibuja|imagina|quiero|necesito|mu[eé]strame).{0,45}(imagen|image|photo|picture|foto|render|illustration|ilustraci[oó]n|portrait|retrato)/i.test(source)
    || /(imagen|image|photo|picture|foto).{0,22}(de|of)\b/i.test(source);
}

function isVisualQuestion(value) {
  const source = text(value);
  return /(qu[eé]\s+ves|que\s+hay|describe|descr[ií]be|analiza\s+(esta|la)\s+(imagen|foto)|what\s+do\s+you\s+see|describe\s+this|what\s+is\s+in|cu[aá]ntos?|count|lee\s+el\s+texto|read\s+the\s+text|compara|compare|se\s+parece|does\s+it\s+look\s+like)/i.test(source);
}

function looksLikeNaturalReferenceGeneration(value, hasImage = true) {
  const source = text(value);
  if (!hasImage || !source) return false;
  if (isVisualQuestion(source) && !/(haz|crea|genera|pon|cambia|convierte|transforma|make|create|generate|turn|change)/i.test(source)) return false;
  if (looksLikeExplicitImageRequest(source)) return true;

  const reference = wantsReference(source);
  const editVerb = /(haz|hazlo|crea|genera|ponlo|ponla|pon\s+|cambia|c[aá]mbialo|convierte|transforma|dibuja|renderiza|make|create|generate|put\s+it|change|turn\s+it|transform)/i.test(source);
  const sceneChange = /(pero|ahora|jugando|corriendo|saltando|en\s+un\s+(parque|bosque|hotel|carro|auto|escena|lugar)|en\s+una\s+(playa|calle|casa|escena)|con\s+\d+\s+|with\s+\d+\s+|playing|running|jumping|at\s+the\s+|in\s+a\s+)/i.test(source);
  const visualSubject = /(perro|perrito|perrita|gato|gata|personaje|persona|carro|auto|producto|dog|puppy|cat|character|person|car|product|estilo|style)/i.test(source);
  const deicticReference = /(esta\s+(foto|imagen)|este\s+(perro|perrito|gato|personaje|objeto)|this\s+(photo|image|dog|puppy|cat|character|object)|el\s+de\s+la\s+(foto|imagen)|la\s+de\s+la\s+(foto|imagen))/i.test(source);

  return reference && (visualSubject || deicticReference) && (editVerb || sceneChange);
}

function shouldGenerateImage(value, hasImage = false) {
  return looksLikeExplicitImageRequest(value) || looksLikeNaturalReferenceGeneration(value, hasImage);
}

function referenceMode(value) {
  const source = text(value);
  const styleOnly = /(mismo\s+estilo|same\s+style)/i.test(source)
    && !/(mismo\s+(perro|perrito|gato|personaje|persona)|same\s+(dog|puppy|cat|character|person)|parecid|similar|identidad)/i.test(source);
  return styleOnly ? 'style' : 'consistency';
}

module.exports = {
  wantsReference,
  looksLikeExplicitImageRequest,
  looksLikeNaturalReferenceGeneration,
  shouldGenerateImage,
  isVisualQuestion,
  referenceMode,
};
