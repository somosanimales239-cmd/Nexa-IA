'use strict';
(() => {
  if (window.__NEXA_IMAGE_INTELLIGENCE_V197__) return;
  window.__NEXA_IMAGE_INTELLIGENCE_V197__ = true;

  function visualCreationIntent(value) {
    const source = String(value || '').trim();
    if (!source) return false;
    if (/^\/(image|img)\b/i.test(source)) return true;
    const promptWriting = /\b(prompt|promt)\b/i.test(source) && /\b(crea|créame|creame|hazme|dame|genera(?:me)?|escribe(?:me)?|write|create)\b/i.test(source);
    if (promptWriting) return false;
    const explicitImage = /(genera(?:me)?|generate|crea(?:me)?|create|haz(?:me)?|make|draw|dibuja|renderiza|render|diseña|design|ilustra|illustrate|mu[eé]strame).{0,55}(imagen|image|foto|photo|picture|render|illustration|ilustraci[oó]n|portrait|retrato)/i.test(source)
      || /(imagen|image|foto|photo|picture).{0,28}(de|of)\b/i.test(source);
    if (explicitImage) return true;
    const creationVerb = /\b(genera(?:me)?|generate|crea(?:me)?|create|haz(?:me)?|make|draw|dibuja|renderiza|render|diseña|design|ilustra|illustrate|construye|build)\b/i.test(source);
    const visualObject = /\b(personaje|personage|character|mascota|mascot|logo|sticker|pegatina|tatuaje|tattoo|portada|cover|poster|p[oó]ster|icono|ícono|icon|guerrera|guerrero|warrior|pr[ií]ncipe|prince|princesa|princess|escena|scene|paisaje|landscape|cityscape|carro|auto|coche|vehicle|animal|perro|dog|gato|cat|canguro|kangaroo|avatar|emblema|emblem)\b/i.test(source);
    const visualStyle = /\b(cartoon|anime|manga|3d|realista|realistic|fotorealista|photorealistic|cinematic|cinem[aá]tico|full body|cuerpo completo|fondo transparente|transparent background|estilo|style)\b/i.test(source);
    return creationVerb && visualObject && (visualStyle || source.length >= 20);
  }

  function install() {
    try {
      const previous = typeof looksLikeImageRequest === 'function' ? looksLikeImageRequest : window.looksLikeImageRequest;
      if (typeof previous !== 'function' || previous.__nexaV197) return typeof previous === 'function';
      const patched = function(value) { return previous(value) || visualCreationIntent(value); };
      patched.__nexaV197 = true;
      window.looksLikeImageRequest = patched;
      try { looksLikeImageRequest = patched; } catch (_) {}
      return true;
    } catch (_) { return false; }
  }
  let tries=0;const timer=setInterval(()=>{tries++;if(install()||tries>30)clearInterval(timer);},250);install();
})();
