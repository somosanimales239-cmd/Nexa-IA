'use strict';

const VERSION = '2.0.4-fastchat';

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
    if (!isConversationalFastPath(question, WebIntel)) return original(event, payload);

    // Restrict only this casual turn to an impossible knowledge scope.
    // This prevents unrelated global automotive K1/K2 retrieval.
    const scope = '__NEXA_HOSTED_FAST_LOCAL_NO_KNOWLEDGE__';
    const outgoing = {
      ...payload,
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
  installWebIntelligenceFastPath,
  wrapCapturedChatHandler,
};
