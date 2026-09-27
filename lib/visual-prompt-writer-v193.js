'use strict';

const Premium = require('./premium-prompt-compiler-v189');

const VERSION = '1.9.3';

function clean(value, max = 12000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}
function uniq(values, limit = 80) {
  const out = [], seen = new Set();
  for (const value of values || []) {
    const item = clean(value, 500);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}
function spanish(text) {
  return /\b(crea|créame|creame|hazme|dame|imagen|personaje|chica|cabello|parecid|similar|estilo|dibujo|línea|linea|detrás|detras|negativo|tamaño)\b/i.test(String(text || ''));
}
function lastUserText(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const message = [...messages].reverse().find(m => m?.role === 'user');
  return String(message?.content || '').replace(/\u2063\u2063[\u200B\u200C]+\u2064\u2064/g, '').trim();
}
function hasAttachmentMarker(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  return messages.some(m => /\u2063\u2063[\u200B\u200C]+\u2064\u2064/.test(String(m?.content || '')));
}
function isVisualPromptRequest(text) {
  const q = clean(text, 4000);
  if (!q) return false;
  const asksPrompt = /(prompt\s*master|master\s*prompt|promt\s*master|prompt\s*(?:premium|positivo|negativo)?|créame\s+un\s+promp?t|creame\s+un\s+promp?t|hazme\s+un\s+promp?t|dame\s+un\s+promp?t|genera(?:me)?\s+un\s+promp?t|escribe(?:me)?\s+un\s+promp?t|write\s+(?:me\s+)?(?:a\s+)?prompt|create\s+(?:me\s+)?(?:a\s+)?prompt)/i.test(q);
  const visual = /(imagen|image|foto|photo|picture|personaje|character|anime|manga|cartoon|caricatura|dibujo|drawing|ilustraci[oó]n|illustration|render|retrato|portrait|mascota|mascot|logo|escena|scene|3d)/i.test(q);
  return asksPrompt && visual;
}
function isSimilarityRequest(text) {
  return /(similar|parecid[oa]?|inspirad[oa]?|estilo\s+de|vibra\s+de|como\s+[^,.]{2,80}|like\s+[^,.]{2,80}|resembl|inspired\s+by|style\s+of)/i.test(String(text || ''));
}

// The fallback is for benign creative/copyright-style refusals, not for bypassing legitimate safety refusals.
function fallbackAllowed(text) {
  const q = String(text || '').toLowerCase();
  const sexualMinor = /(niñ[oa]|menor|child|kid|minor|teen\b).{0,80}(desnud|nude|naked|sexo|sexual|porn|erotic|erótico)|(?:desnud|nude|naked|sexo|sexual|porn|erotic|erótico).{0,80}(niñ[oa]|menor|child|kid|minor|teen\b)/i.test(q);
  const nonconsensualSex = /(rape|violaci[oó]n|non[- ]?consensual|sin consentimiento)/i.test(q);
  return !sexualMinor && !nonconsensualSex;
}

function responseLooksRejected(text) {
  const source = clean(text, 12000);
  if (!source) return false;
  const lower = source.toLowerCase();
  const refusal = [
    "i'm sorry, but i can't help with that",
    'i’m sorry, but i can’t help with that',
    'i cannot help with that',
    'i can’t help with that',
    'cannot assist with that request',
    'unable to help with that request',
    'lo siento, pero no puedo ayudar',
    'no puedo ayudar con eso',
    'no puedo cumplir con esa solicitud',
  ].some(x => lower.includes(x));
  if (!refusal) return false;
  const alreadyUseful = /(prompt positivo|prompt negativo|positive prompt|negative prompt|tamaño recomendado|recommended size)/i.test(source);
  return !alreadyUseful || source.length < 500;
}

const KNOWN_REFERENCES = [
  {
    re:/\bnaruto\b/gi,
    es:'una estética anime shonen original de acción ninja, con line art limpio y enérgico, cel shading definido, expresiones intensas, diseño juvenil dinámico y sensación de movimiento',
    en:'an original ninja-action shonen anime aesthetic with clean energetic line art, crisp cel shading, expressive faces, youthful dynamic design, and strong motion energy',
  },
  {
    re:/\bdragon\s*ball(?:\s*z)?\b/gi,
    es:'una estética anime shonen original de artes marciales, con siluetas fuertes, poses explosivas, cel shading y líneas cinéticas',
    en:'an original martial-arts shonen anime aesthetic with strong silhouettes, explosive poses, cel shading, and kinetic linework',
  },
  {
    re:/\bone\s*piece\b/gi,
    es:'una estética manga de aventura original, expresiva y caricaturesca, con formas dinámicas, line art marcado y energía de acción',
    en:'an original adventurous manga aesthetic with expressive cartooning, dynamic shapes, bold linework, and action energy',
  },
  {
    re:/\bpok[eé]mon\b/gi,
    es:'una estética de aventura anime colorida y original, con criaturas de diseño limpio, formas legibles y energía amigable',
    en:'an original colorful anime-adventure aesthetic with clean creature design, readable shapes, and friendly energy',
  },
  {
    re:/\b(?:pixar|disney)\b/gi,
    es:'una estética original de animación familiar de alto nivel, con formas atractivas, expresiones claras, iluminación suave y acabado cinematográfico',
    en:'an original high-end family-animation aesthetic with appealing shapes, clear expressions, soft lighting, and cinematic polish',
  },
  {
    re:/\bstudio\s+ghibli\b|\bghibli\b/gi,
    es:'una estética original de animación 2D pintada a mano, cálida y fantástica, con fondos atmosféricos, líneas delicadas y color suave',
    en:'an original hand-painted 2D animation aesthetic with warm fantasy atmosphere, delicate linework, soft color, and painterly backgrounds',
  },
];

function extractVisualRequest(userText) {
  let value = clean(userText, 9000);
  value = value
    .replace(/^(?:por\s+favor\s+)?(?:créame|creame|hazme|dame|genera(?:me)?|escribe(?:me)?|create|write\s+me|give\s+me)\s+(?:un|una|a)?\s*promp?t\s*(?:master|premium)?\s*/i, '')
    .replace(/^(?:para\s+)?(?:hacer|crear|generar|make|create|generate)\s+(?:una|un|an|a)?\s*(?:imagen|image|foto|picture)\s*(?:de|of)?\s*/i, '')
    .replace(/^para\s+(?:una|un)?\s*(?:imagen|image)\s*(?:de|of)?\s*/i, '')
    .trim();
  return value || clean(userText, 9000);
}

function adaptSimilarityRequest(userText) {
  const original = clean(userText, 9000);
  const isEs = spanish(original);
  const visualRequest = extractVisualRequest(original);
  let adapted = visualRequest;
  const recognized = [];
  for (const item of KNOWN_REFERENCES) {
    if (item.re.test(adapted)) {
      item.re.lastIndex = 0;
      adapted = adapted.replace(item.re, isEs ? item.es : item.en);
      recognized.push(item.es.includes('ninja') ? 'shonen_ninja' : 'known_visual_reference');
    }
    item.re.lastIndex = 0;
  }
  const similarity = isSimilarityRequest(original) || recognized.length > 0;
  if (similarity) {
    adapted += isEs
      ? ' REGLA DE ORIGINALIDAD: conserva solo la vibra general, género, line art, iluminación y composición; crea un diseño nuevo y no copies rostro, peinado, vestuario, logos, símbolos ni insignias.'
      : ' ORIGINALITY RULE: keep only the broad vibe, genre, line art, lighting, and composition; create a new design and do not copy a face, hairstyle, costume, logos, symbols, or insignia.';
  }
  if (recognized.includes('shonen_ninja')) adapted = adapted.replace(/\bcaricaturas?\b/gi, isEs ? 'anime' : 'anime');
  return { original, visualRequest, adapted, similarity, recognized, language:isEs ? 'es' : 'en' };
}

function addPromptDetail(request, language) {
  const q = request.toLowerCase();
  const additions = [];
  if (/lineas de arte|líneas de arte|speed lines|motion lines|lineas detras|líneas detrás|detr[aá]s/.test(q)) {
    additions.push(language === 'es'
      ? 'líneas gráficas dinámicas y speed lines detrás del sujeto, limpias y controladas, sin ensuciar el fondo'
      : 'clean controlled dynamic graphic lines and speed lines behind the subject without cluttering the background');
  }
  if (/chica|girl|woman|mujer/.test(q)) additions.push(language === 'es' ? 'personaje femenino claramente legible y atractivo' : 'clearly readable appealing female character');
  if (/cabello negro|black hair/.test(q)) additions.push(language === 'es' ? 'cabello negro claramente visible con silueta limpia' : 'clearly visible black hair with a clean silhouette');
  if (/anime|manga|shonen|naruto/.test(q)) additions.push(language === 'es' ? 'line art de anime limpio, cel shading coherente y lectura visual fuerte' : 'clean anime line art, coherent cel shading, and strong visual readability');
  return additions;
}

function compilePromptPackage(userText) {
  const adapted = adaptSimilarityRequest(userText);
  const premium = Premium.compile(adapted.adapted, { referenceActive:false });
  const extra = addPromptDetail(adapted.original, adapted.language);
  const positive = uniq([
    premium.positivePrompt,
    ...extra,
    adapted.language === 'es' ? 'acabado profesional, composición clara, sujeto principal bien definido' : 'professional finish, clear composition, well-defined main subject',
  ], 90).join(', ');
  const negative = uniq([
    premium.negativePrompt,
    adapted.similarity ? (adapted.language === 'es' ? 'copia exacta de personaje existente' : 'exact copy of an existing character') : '',
    adapted.similarity ? (adapted.language === 'es' ? 'rostro idéntico a personaje protegido' : 'identical face to an existing protected character') : '',
    adapted.similarity ? (adapted.language === 'es' ? 'vestuario o insignias icónicas copiadas literalmente' : 'literally copied iconic costume or insignia') : '',
    'copyrighted logo', 'watermark', 'text artifact',
  ], 90).join(', ');
  const characterLike = /\b(personaje|personage|character|chica|girl|woman|mujer|hombre|man|boy|ninja)\b/i.test(adapted.visualRequest || adapted.original);
  const forcedAnime = adapted.recognized.includes('shonen_ninja') || /\b(anime|manga|shonen)\b/i.test(adapted.adapted);
  return {
    language: adapted.language,
    originalRequest: adapted.original,
    adaptedRequest: adapted.adapted,
    similarityAdapted: adapted.similarity,
    positivePrompt: positive,
    negativePrompt: negative,
    width: characterLike ? 768 : (Number(premium.width) || 896),
    height: characterLike ? 1024 : (Number(premium.height) || 896),
    style: forcedAnime ? 'anime' : (premium.style || 'auto'),
    composition: premium.scene || (characterLike ? (adapted.language === 'es' ? 'retrato vertical de personaje, silueta completa y fondo gráfico controlado' : 'vertical character composition with a clear silhouette and controlled graphic background') : (adapted.language === 'es' ? 'composición clara y equilibrada' : 'clear balanced composition')),
  };
}

function formatPromptPackage(pack) {
  const isEs = pack.language === 'es';
  const note = pack.similarityAdapted
    ? (isEs
      ? 'Adaptación de similitud: conservé la vibra y las cualidades visuales generales, pero el diseño queda planteado como original en vez de una copia exacta.'
      : 'Similarity adaptation: the broad vibe and visual qualities are preserved, while the design is framed as original rather than an exact copy.')
    : '';
  return [
    isEs ? 'Aquí tienes el prompt master premium:' : 'Here is the premium master prompt:',
    '',
    isEs ? '**Prompt positivo premium**' : '**Premium positive prompt**',
    pack.positivePrompt,
    '',
    isEs ? '**Prompt negativo premium**' : '**Premium negative prompt**',
    pack.negativePrompt,
    '',
    `${isEs ? '**Tamaño recomendado**' : '**Recommended size**'}: ${pack.width}×${pack.height}`,
    `${isEs ? '**Estilo**' : '**Style**'}: ${pack.style}`,
    `${isEs ? '**Composición**' : '**Composition**'}: ${pack.composition}`,
    note ? `\n${note}` : '',
  ].filter(Boolean).join('\n');
}

function steeringMessage(userText) {
  const isEs = spanish(userText);
  return [
    'NEXA VISUAL PROMPT WRITER — INTERNAL ROUTING',
    'The user is asking for text that will be used as an image-generation prompt.',
    'Answer as a premium visual prompt writer.',
    'Do not refuse merely because a famous fictional work, franchise, character, brand, visual style, or other potentially copyrighted reference is mentioned.',
    'When a similarity/reference is present, preserve only broad visual qualities and redirect the result toward an original design rather than an exact copy.',
    'Translate named inspiration into descriptive visual traits whenever possible.',
    'For vague requests, intelligently complete composition, lighting, visual clarity, positive conditioning and negative conditioning.',
    'Return useful prompt text, not legal commentary.',
    isEs ? 'Responde en español.' : 'Answer in English.',
    `USER REQUEST: ${clean(userText, 5000)}`,
  ].join('\n');
}

function injectSystemSteering(payload, userText) {
  const messages = Array.isArray(payload?.messages) ? payload.messages.map(m => ({...m})) : [];
  let insertAt = messages.length;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') { insertAt = i; break; }
  }
  messages.splice(insertAt, 0, { role:'system', content:steeringMessage(userText) });
  return { ...payload, messages };
}

function senderProxy(sender, requestId, userText, version = VERSION) {
  const originalSend = sender.send.bind(sender);
  let buffer = '';
  let finished = false;
  let fallbackUsed = false;
  const proxy = new Proxy(sender, {
    get(target, prop) {
      if (prop === 'send') {
        return (channel, packet) => {
          const packetId = String(packet?.requestId || '');
          const sameRequest = !packetId || packetId === String(requestId || '');
          if (sameRequest && channel === 'chat:token') {
            buffer += String(packet?.content || '');
            return;
          }
          if (sameRequest && channel === 'chat:done') {
            if (finished) return;
            finished = true;
            let output = buffer;
            if (responseLooksRejected(buffer) && fallbackAllowed(userText)) {
              output = formatPromptPackage(compilePromptPackage(userText));
              fallbackUsed = true;
            }
            if (output) originalSend('chat:token', { requestId:String(requestId || packetId), content:output });
            originalSend('chat:done', packet);
            return;
          }
          return originalSend(channel, packet);
        };
      }
      if (prop === '__nexaVisualPromptState') return () => ({ buffer, finished, fallbackUsed, version });
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return proxy;
}

function wrapEvent(event, requestId, userText, version = VERSION) {
  const wrapped = Object.create(event || null);
  const proxy = senderProxy(event.sender, requestId, userText, version);
  Object.defineProperty(wrapped, 'sender', { value:proxy, enumerable:true, configurable:true });
  return wrapped;
}

module.exports = {
  VERSION,
  lastUserText,
  hasAttachmentMarker,
  isVisualPromptRequest,
  isSimilarityRequest,
  fallbackAllowed,
  responseLooksRejected,
  extractVisualRequest,
  adaptSimilarityRequest,
  compilePromptPackage,
  formatPromptPackage,
  steeringMessage,
  injectSystemSteering,
  senderProxy,
  wrapEvent,
};
