'use strict';

const VERSION = '2.0.4-fastchat+benign-intent-r1';

function normalize(value) {
  return String(value || '')
    .replace(/\u2063\u2063[\u200B\u200C]+\u2064\u2064/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonical(value) {
  return normalize(value)
    .toLowerCase()
    .replace(/[¿?¡!.,;:()[\]{}"'`~_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lastUserText(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const row = [...messages].reverse().find(m => m?.role === 'user');
  return normalize(row?.content || '');
}

function fallbackExplicitWeb(q) {
  return /\b(busca|búscalo|buscar|investiga|investigar|verifica|verificar|comprueba|comprobar|averigua|internet|web|online|google|search|look\s*up|find\s+online|research|verify|check\s+online)\b/i.test(q);
}
function fallbackCurrent(q) {
  return /\b(hoy|ahora|actual|actualmente|reciente|último|última|nueva versión|noticias|precio|precios|cotización|disponible|vigente|latest|current|today|recent|news|price|available|release|released)\b/i.test(q);
}
function fallbackHighRisk(q) {
  return /\b(torque|ft-?lb|part\s*number|número de parte|dtc\b|tsb\b|repair manual|manual de reparación|pinout|wiring diagram|diagrama eléctrico|fuel pressure|presión de combustible|specification|especificación|firmware|driver version|tax rate|tasa de impuesto|ley vigente|regulation|regulación|dosage|dosis|interaction|interacción)\b/i.test(q);
}

function isConversationalFastPath(question, WebIntel = null) {
  const q = normalize(question);
  if (!q || q.length > 180) return false;

  const explicit = WebIntel?.explicitWebRequest ? WebIntel.explicitWebRequest(q) : fallbackExplicitWeb(q);
  const current = WebIntel?.currentInfoRequest ? WebIntel.currentInfoRequest(q) : fallbackCurrent(q);
  const exact = WebIntel?.exactOrHighRiskFact ? WebIntel.exactOrHighRiskFact(q) : fallbackHighRisk(q);
  if (explicit || current || exact) return false;

  const c = canonical(q);
  return /^(hola|hello|hi|hey|buenas|buenos dias|buenos días|buenas tardes|buenas noches)( (como|cómo) (estas|estás|andas|te va)| que tal| todo bien)?$/.test(c)
    || /^(gracias|muchas gracias|thank you|thanks|ok|okay|perfecto|perfect|entendido|vale|de acuerdo)$/.test(c)
    || /^(quien|quién) eres$/.test(c);
}

function hasBlockedAdultContext(q) {
  return /\b(menor(?:es)?|niñ[oa]s?|infant(?:e|il)?|underage|minor(?:s)?|child(?:ren)?|preteen|pre-teen|adolescente(?:s)?|sin consentimiento|no consentido|non[- ]consensual|rape|violaci[oó]n|coacci[oó]n|coercion|trata de personas|human trafficking|sex trafficking|explotaci[oó]n sexual|revenge porn|c[aá]mara oculta|hidden camera)\b/i.test(q);
}

function isBenignAdultPlatformEngineeringRequest(question) {
  const q = canonical(question);
  if (!q || hasBlockedAdultContext(q)) return false;

  const adultPlatform = /\b(skyprivate|onlyfans|fansly|chaturbate|stripchat|myfreecams|adult(?:o|os|a|as)?|18\+|webcam|cam site|cam platform|creator platform|plataforma de creadores|p[aá]gina(?:s)? de adulto|sitio(?:s)? de adulto|adult website|adult platform)\b/i.test(q);
  if (!adultPlatform) return false;

  const engineeringVerb = /\b(desarroll|program|crear|constru|diseñ|disen|arquitect|implementar|integrar|hacer una app|hacer un sitio|make an app|build|develop|code|program|design|architect|implement|integrate)\w*/i.test(q);
  const productTerms = q.match(/\b(software|app|aplicaci[oó]n|p[aá]gina|sitio|web|plataforma|marketplace|backend|frontend|api|database|base de datos|perfil(?:es)?|registro|login|pago(?:s)?|payment|billing|suscripci[oó]n|subscription|wallet|saldo|comisi[oó]n|commission|chat|mensajer[ií]a|video(?:llamada|chat)?|streaming|panel|dashboard|studio|modelo(?:s)?|creator(?:s)?|moderaci[oó]n|moderation|verificaci[oó]n|verification|seguridad|security|privacidad|privacy|negocio|business|monetizaci[oó]n|monetization)\b/gi) || [];

  return engineeringVerb || productTerms.length >= 2;
}

function benignAdultPlatformSystemContext(question) {
  if (!isBenignAdultPlatformEngineeringRequest(question)) return '';
  return [
    'NEXA INTERNAL INTENT CLARIFICATION.',
    'The user is asking about legal software, product, business, architecture, or engineering for an adult-only platform. This is not, by itself, a request to generate sexually explicit material.',
    'Do not refuse merely because the request mentions SkyPrivate, an adult website, webcam platform, creator platform, or other adult-industry service.',
    'Answer the technical/product request normally when it is about software architecture, profiles, payments, subscriptions, messaging, private video calls, creator/studio dashboards, commissions, age/identity verification, consent controls, moderation, privacy, security, fraud prevention, abuse reporting, billing, or compliance.',
    'Assume participants are consenting adults age 18+ unless the user says otherwise.',
    'Do not create or facilitate sexual content involving minors, non-consensual sexual activity, exploitation, trafficking, hidden-camera abuse, or other unlawful abuse. If the user later asks for a different unsafe activity, evaluate that separate request on its own merits.',
    'Interpret the current request according to its real software/business intent instead of treating the word “adult” as an automatic refusal trigger.',
  ].join(' ');
}

function injectIntentContext(payload, context) {
  if (!context) return payload;
  const messages = Array.isArray(payload?.messages) ? payload.messages.map(m => ({ ...m })) : [];
  const alreadyInjected = messages.some(m => m?.role === 'system' && String(m?.content || '').includes('NEXA INTERNAL INTENT CLARIFICATION.'));
  if (!alreadyInjected) {
    let insertAt = messages.length;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'user') { insertAt = i; break; }
    }
    messages.splice(insertAt, 0, { role:'system', content:context });
  }
  return { ...payload, messages, _nexaBenignIntentContext:true };
}

function localPlan(question) {
  return {
    web_required:false,
    local_confidence:1,
    intent:'casual_conversation',
    freshness:'not_applicable',
    depth:'quick',
    reason:'Hosted Web fast conversational route: no web research required.',
    queries:[],
    preferred_sources:[],
    preferred_domains:[],
    verification:[],
    max_sources:0,
    language:/[¿¡áéíóúñ]|\b(hola|como|cómo|gracias|buenas)\b/i.test(question)?'es':'en',
    deterministic:true,
    fast_path:true,
  };
}

function installWebIntelligenceFastPath() {
  let WebIntel;
  try { WebIntel = require('./web-intelligence-v191'); }
  catch (_) { return false; }

  if (!WebIntel || WebIntel.__nexaHostedFastChatInstalled) return true;
  const originalResearch = typeof WebIntel.researchForChat === 'function'
    ? WebIntel.researchForChat.bind(WebIntel)
    : null;
  if (!originalResearch) return false;

  WebIntel.researchForChat = async function(question, settings, options = {}) {
    if (isConversationalFastPath(question, WebIntel)) {
      options?.progress?.('local-fast', 'Nexa Web: conversación simple · respuesta local inmediata.');
      return {used:false,plan:localPlan(question),sources:[],verification:null,fastPath:true};
    }
    return originalResearch(question, settings, options);
  };

  WebIntel.__nexaHostedFastChatInstalled = true;
  WebIntel.__nexaHostedFastChatVersion = VERSION;
  return true;
}

function wrapCapturedChatHandler(handlers) {
  if (!handlers || typeof handlers.get !== 'function' || typeof handlers.set !== 'function') return false;
  const original = handlers.get('chat:start');
  if (typeof original !== 'function' || original.__nexaHostedFastChatWrapped) return Boolean(original);

  let WebIntel = null;
  try { WebIntel = require('./web-intelligence-v191'); } catch (_) {}

  const wrapped = async function(event, payload = {}) {
    const question = lastUserText(payload);
    const context = benignAdultPlatformSystemContext(question);
    let outgoing = injectIntentContext(payload, context);

    if (context) {
      try {
        if (event?.sender && !event.sender.isDestroyed()) {
          event.sender.send('web-intelligence:progress', {
            requestId:String(payload?.requestId || ''),
            phase:'intent-context',
            label:'Nexa: intención de software/negocio 18+ detectada · evitando falso rechazo por contexto adulto.',
            hostedBenignIntent:true,
          });
        }
      } catch (_) {}
    }

    if (!isConversationalFastPath(question, WebIntel)) return original(event, outgoing);

    // Restrict only this casual turn to an impossible knowledge scope.
    // This prevents unrelated global automotive K1/K2 retrieval.
    const scope = '__NEXA_HOSTED_FAST_LOCAL_NO_KNOWLEDGE__';
    outgoing = {
      ...outgoing,
      libraryIds:[scope],
      objectiveIds:[scope],
      _nexaHostedFastPath:true,
    };

    try {
      if (event?.sender && !event.sender.isDestroyed()) {
        event.sender.send('web-intelligence:progress', {
          requestId:String(payload?.requestId || ''),
          phase:'local-fast',
          label:'Nexa: conversación simple · sin búsqueda web ni Knowledge irrelevante.',
          hostedFastPath:true,
        });
      }
    } catch (_) {}

    return original(event, outgoing);
  };

  wrapped.__nexaHostedFastChatWrapped = true;
  handlers.set('chat:start', wrapped);
  return true;
}

module.exports = {
  VERSION,
  normalize,
  canonical,
  lastUserText,
  isConversationalFastPath,
  isBenignAdultPlatformEngineeringRequest,
  benignAdultPlatformSystemContext,
  injectIntentContext,
  installWebIntelligenceFastPath,
  wrapCapturedChatHandler,
};
