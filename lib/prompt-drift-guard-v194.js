'use strict';

const VERSION = '1.9.4';

function clean(value, max = 12000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}
function uniq(values, limit = 120) {
  const out = [], seen = new Set();
  for (const raw of values || []) {
    const value = clean(raw, 900);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}
function has(re, text) { return re.test(String(text || '')); }
function matches(text, regexes, limit = 30) {
  const out = [];
  for (const re of regexes) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      out.push(m[0]);
      if (!re.global || out.length >= limit) break;
    }
    re.lastIndex = 0;
    if (out.length >= limit) break;
  }
  return uniq(out, limit);
}
function splitClauses(text) {
  return uniq(String(text || '')
    .split(/[,;\n]|\.(?=\s+[A-ZÁÉÍÓÚÑ])/)
    .map(x => clean(x, 420))
    .filter(x => x.length >= 5 && x.length <= 420), 24);
}

function analyze(userRequest) {
  const text = clean(userRequest, 10000);
  const lower = text.toLowerCase();
  const clauses = splitClauses(text);

  const role = matches(text, [
    /\b(?:warrior|fighter|boxer|soldier|ninja|samurai|knight|assassin|mage|wizard|witch|hero|villain|guerrera|guerrero|luchadora|luchador|boxeadora|boxeador|soldado|soldada|caballero|asesina|asesino|bruja|h[eé]roe|villano)\b/gi,
  ]);
  const outfit = matches(text, [
    /\b(?:wearing|dressed in|vestida con|vestido con|viste|ropa de|outfit|armor|armadura|jacket|chaqueta|coat|abrigo|robe|t[uú]nica|boots|botas|combat boots|botas de combate|knee pads|rodilleras|gloves|guantes|cape|capa|helmet|casco|hat|sombrero)\b[^,;.]{0,90}/gi,
  ]);
  const action = matches(text, [
    /\b(?:dynamic|din[aá]mic[oa]|action|acci[oó]n|battle|batalla|combat|combate|fight|fighting|lucha|luchando|running|corriendo|jumping|saltando|flying|volando|dancing|bailando|boxing|boxeando|punch|golpeando|kick|pateando|attack|atacando|defending|defendiendo|fists? raised|puños? levantados?|holding|sosteniendo|riding|montando|driving|conduciendo|aiming|apuntando)\b[^,;.]{0,100}/gi,
  ]);
  const environment = matches(text, [
    /\b(?:background|fondo|environment|entorno|scene|escena|city|ciudad|urban|urbano|street|calle|night|noche|neon|ne[oó]n|smoke|humo|park|parque|forest|bosque|beach|playa|desert|desierto|battlefield|campo de batalla|room|habitaci[oó]n|mountain|montaña|space|espacio)\b[^,;.]{0,100}/gi,
  ]);
  const rendering = matches(text, [
    /\b(?:anime|manga|cartoon|caricatura|comic|c[oó]mic|photorealistic|fotorealista|realistic|realista|3d|cinematic|cinem[aá]tic[oa]|watercolor|acuarela|oil painting|pintura al [oó]leo|line art|dibujo lineal|cel shading|solid color|color s[oó]lido|ink|tinta|vector|pixel art|palette|paleta)\b[^,;.]{0,90}/gi,
  ]);
  const framing = matches(text, [
    /\b(?:full body|cuerpo completo|de pies a cabeza|close[- ]?up|primer plano|encuadre cercano|portrait|retrato|wide shot|plano general|medium shot|plano medio|three quarter|3\/4)\b/gi,
  ]);
  const appearance = matches(text, [
    /\b(?:beautiful|pretty|cute|handsome|attractive|linda|bonita|hermosa|atractiva|guapo|guapa|adorable|black hair|cabello negro|pelo negro|blonde|rubia|rubio|red hair|pelirroja|pelirrojo|blue eyes|ojos azules|green eyes|ojos verdes)\b[^,;.]{0,80}/gi,
  ]);

  const dynamic = action.length > 0 || has(/\b(?:action|acci[oó]n|battle|batalla|combat|combate|dynamic|din[aá]mic)/i, lower);
  const roleAppearanceConflict = role.length > 0 && appearance.length > 0;
  const portraitActionConflict = dynamic && framing.some(x => /portrait|retrato|close|primer plano|encuadre cercano/i.test(x));
  const detailedEnvironment = environment.length > 0;
  const explicitRendering = rendering.length > 0;

  let score = 0;
  if (roleAppearanceConflict) score += 2;
  if (portraitActionConflict) score += 2;
  if (dynamic) score += 2;
  if (detailedEnvironment) score += 1;
  if (explicitRendering) score += 1;
  if (outfit.length) score += 1;
  if (clauses.length >= 5) score += 1;
  const risk = score >= 6 ? 'high' : score >= 3 ? 'medium' : 'low';

  return {
    text, clauses, role, outfit, action, environment, rendering, framing, appearance,
    dynamic, roleAppearanceConflict, portraitActionConflict, detailedEnvironment, explicitRendering,
    risk,
  };
}

function positiveReinforcement(info) {
  const pos = [
    'constraint fusion: preserve all explicit user-requested visual elements together in one coherent image',
    'do not simplify the request by keeping only the easiest, prettiest, or most dominant trait',
  ];
  if (info.role.length) pos.push(`requested role/archetype remains clearly readable: ${info.role.join(' | ')}`);
  if (info.appearance.length) pos.push(`requested appearance remains visible together with the role/action: ${info.appearance.join(' | ')}`);
  if (info.outfit.length) pos.push(`requested clothing and gear remain visibly present: ${info.outfit.join(' | ')}`);
  if (info.action.length) pos.push(`requested pose/action remains clearly readable: ${info.action.join(' | ')}`);
  if (info.environment.length) pos.push(`requested environment/background remains visibly recognizable: ${info.environment.join(' | ')}`);
  if (info.rendering.length) pos.push(`requested visual/rendering language remains consistent: ${info.rendering.join(' | ')}`);
  if (info.framing.length) pos.push(`requested framing remains respected: ${info.framing.join(' | ')}`);
  if (info.roleAppearanceConflict) pos.push('the subject must simultaneously read as attractive/appealing AND as the requested role; one trait must not erase the other');
  if (info.dynamic) pos.push('strong readable action energy; body language and composition must not collapse into a calm static portrait');
  if (info.detailedEnvironment) pos.push('background is story-bearing content, not disposable decoration; keep it readable instead of generic blur');
  if (info.explicitRendering) pos.push('rendering instructions are content constraints; do not soften them into a generic house style');
  if (info.risk === 'high') pos.push('STRICT ANTI-DRIFT MODE: subject, role, appearance, outfit, action, environment, framing and rendering must coexist when requested');
  return uniq(pos, 50);
}

function negativeReinforcement(info) {
  const neg = [
    'prompt drift',
    'dropped requested attribute',
    'ignored user constraint',
    'genericized interpretation',
    'single-trait simplification',
  ];
  if (info.roleAppearanceConflict) neg.push('generic beauty portrait without the requested role', 'fashion portrait replacing the requested warrior/fighter/archetype');
  if (info.dynamic) neg.push('static portrait', 'calm standing pose', 'passive pose replacing requested action', 'missing action cues');
  if (info.outfit.length) neg.push('simplified outfit', 'missing requested clothing', 'missing requested gear');
  if (info.environment.length) neg.push('generic blurred background', 'missing requested environment', 'empty backdrop replacing requested scene');
  if (info.rendering.length) neg.push('style drift', 'generic soft illustration replacing requested line art/cel shading/rendering', 'rendering style mismatch');
  if (info.framing.length) neg.push('framing drift', 'unrequested crop');
  return uniq(neg, 50);
}

function hardRequirements(info) {
  const hard = [
    'all explicit requested visual constraints must coexist; do not drop one requested category to favor another',
  ];
  if (info.role.length) hard.push(`requested role/archetype must remain visually readable: ${info.role.join(' | ')}`);
  if (info.outfit.length) hard.push(`requested clothing/gear must remain visible: ${info.outfit.join(' | ')}`);
  if (info.action.length) hard.push(`requested action/pose must remain visibly readable and must not become static: ${info.action.join(' | ')}`);
  if (info.environment.length) hard.push(`requested environment/background must remain visibly present and recognizable: ${info.environment.join(' | ')}`);
  if (info.rendering.length) hard.push(`requested rendering/style treatment must remain visibly present: ${info.rendering.join(' | ')}`);
  if (info.framing.length) hard.push(`requested framing must remain respected: ${info.framing.join(' | ')}`);
  if (info.roleAppearanceConflict) hard.push('appearance and role are simultaneous requirements; attractive/beautiful does not replace warrior/fighter/role identity');
  return uniq(hard, 30);
}

function install(Compiler) {
  if (!Compiler || Compiler.__nexaPromptDriftGuardV194) return Compiler;
  const originalCompile = Compiler.compile.bind(Compiler);
  Compiler.compile = function(userRequest, opts = {}) {
    const base = originalCompile(userRequest, opts);
    const info = analyze(userRequest);
    const positive = uniq([base.positivePrompt, ...positiveReinforcement(info)], 110).join(', ');
    const negative = uniq([base.negativePrompt, ...negativeReinforcement(info)], 110).join(', ');
    const hard = uniq([...(base.hardRequirements || []), ...hardRequirements(info)], 60);
    return {
      ...base,
      positivePrompt: positive,
      negativePrompt: negative,
      hardRequirements: hard,
      promptDriftGuard: {
        version: VERSION,
        risk: info.risk,
        clauses: info.clauses,
        preserved: {
          role: info.role,
          appearance: info.appearance,
          outfit: info.outfit,
          action: info.action,
          environment: info.environment,
          rendering: info.rendering,
          framing: info.framing,
        },
      },
    };
  };
  Compiler.__nexaPromptDriftGuardV194 = true;
  Compiler.__nexaPromptDriftGuardVersion = VERSION;
  return Compiler;
}

module.exports = {
  VERSION, analyze, positiveReinforcement, negativeReinforcement, hardRequirements, install,
};
