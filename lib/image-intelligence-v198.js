'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const VERSION = '1.9.8';
const HighRes = require('./highres-pipeline-v198');

function clean(value, max = 20000) {
  return String(value ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}
function oneLine(value, max = 20000) { return clean(value, max).replace(/\s+/g, ' ').trim(); }
function uniq(values, limit = 120) {
  const out = [], seen = new Set();
  for (const raw of values || []) {
    const value = oneLine(raw, 1000);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}
function has(re, value) { re.lastIndex = 0; const ok = re.test(String(value || '')); re.lastIndex = 0; return ok; }

function isVisualCreationIntent(value) {
  const source = oneLine(value, 5000);
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

function stripMarkdown(value) {
  return String(value || '')
    .replace(/```(?:[a-z0-9_-]+)?/gi, '')
    .replace(/```/g, '')
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/gm, '')
    .trim();
}

function splitPromptSections(value) {
  const raw = stripMarkdown(value);
  const markers = [/\bnegative\s+prompt\b\s*[:\-]?/i,/\bprompt\s+negativo\b\s*[:\-]?/i,/\bnegativo\b\s*[:\-]?/i];
  let index = -1, markerLength = 0;
  for (const re of markers) {
    const m = re.exec(raw);
    if (m && (index < 0 || m.index < index)) { index = m.index; markerLength = m[0].length; }
  }
  let positive = index >= 0 ? raw.slice(0, index) : raw;
  let negative = index >= 0 ? raw.slice(index + markerLength) : '';
  const trailing = /\b(?:how\s+to\s+use|consejos?\s+de\s+uso|trazabilidad|recommended\s+settings|ajustes?\s+recomendados?|cfg\s*\/\s*guidance|modelo\s*:|resoluci[oó]n\s*:|post[- ]?procesado)\b/i;
  const pTrail = trailing.exec(positive); if (pTrail) positive = positive.slice(0, pTrail.index);
  const nTrail = trailing.exec(negative); if (nTrail) negative = negative.slice(0, nTrail.index);
  positive = positive.replace(/^\s*(?:positive\s+prompt|prompt\s+positivo)(?:\s*\([^)]*\))?\s*[:\-]?\s*/i, '').replace(/^\s*["“]|["”]\s*$/g, '').trim();
  negative = negative.replace(/^\s*["“]|["”]\s*$/g, '').trim();
  return { positive: clean(positive, 14000), negative: clean(negative, 8000), raw: clean(raw, 20000) };
}

function extractTechnicalSpec(raw) {
  const text = oneLine(raw, 12000);
  const transparent = /\b(fondo\s+transparente|transparent\s+background|sin\s+fondo|no\s+background|png\s+transparente|transparent\s+png|alpha\s+background|cutout)\b/i.test(text);
  const vertical = /\b(vertical|portrait orientation|orientaci[oó]n vertical|9\s*:\s*16)\b/i.test(text);
  const horizontal = /\b(horizontal|landscape orientation|orientaci[oó]n horizontal|16\s*:\s*9)\b/i.test(text);
  const square = /\b(cuadrad[oa]|square|1\s*:\s*1)\b/i.test(text);
  const fullBody = /\b(cuerpo completo|full body|head to toe|de pies a cabeza)\b/i.test(text);
  const explicit = text.match(/\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b/i);
  let exactWidth = explicit ? Number(explicit[1]) : 0;
  let exactHeight = explicit ? Number(explicit[2]) : 0;
  const wants4k = /\b4\s*k\b|\buhd\b|\bultra\s*hd\b/i.test(text);
  const wants2k = /\b2\s*k\b|\bqhd\b/i.test(text);
  const wants1080 = /\b1080\s*p\b|\bfull\s*hd\b/i.test(text);
  const dpi = Number((text.match(/\b(\d{2,4})\s*dpi\b/i) || [])[1] || 0);
  return { transparent, vertical, horizontal, square, fullBody, exactWidth, exactHeight, wants4k, wants2k, wants1080, dpi };
}

function detectStyle(text) {
  const source = oneLine(text, 10000);
  if (/\b(photo[- ]?real|photorealistic|fotorealista|realistic|realista|realism|realismo|documentary photography|fotograf[ií]a realista)\b/i.test(source)) return 'photorealistic';
  if (/\b(anime|manga|shonen)\b/i.test(source)) return 'anime';
  if (/\b(cartoon|caricatura|dibujo animado|family animation|animaci[oó]n familiar|disney-like|pixar-like)\b/i.test(source)) return 'cartoon';
  if (/\b(3d|cgi|render 3d|3d animation|animaci[oó]n 3d)\b/i.test(source)) return '3d_animation';
  if (/\b(vector|logo|flat graphic|gr[aá]fico plano)\b/i.test(source)) return 'graphic';
  return 'auto';
}

const NAMED_STYLE_MAP = [
  { re:/\bdisney\b/gi, replacement:'original premium family-animation fairy-tale aesthetic, appealing expressive shapes, polished storybook character design, cinematic animated finish', avoid:['recognizable existing franchise character','iconic mascot resemblance','round mouse mascot ears','existing copyrighted prince or princess design','copied franchise costume or insignia'] },
  { re:/\bpixar\b/gi, replacement:'original high-end stylized 3D family-animation aesthetic, appealing proportions, expressive faces, soft cinematic lighting, polished feature-animation finish', avoid:['recognizable existing franchise character','copied mascot identity','copied franchise costume or insignia'] },
  { re:/\bnaruto\b/gi, replacement:'original energetic ninja-action shonen anime aesthetic, clean dynamic line art, crisp cel shading, youthful heroic design, strong motion language', avoid:['recognizable existing anime character','copied ninja costume','copied headband symbol','copied hairstyle or face'] },
  { re:/\bstudio\s+ghibli\b|\bghibli\b/gi, replacement:'original hand-painted 2D fantasy-animation aesthetic, delicate linework, warm atmospheric backgrounds, soft natural color, whimsical cinematic mood', avoid:['recognizable existing studio character','copied costume or face'] },
  { re:/\bdragon\s*ball(?:\s*z)?\b/gi, replacement:'original martial-arts shonen anime aesthetic, strong silhouettes, explosive poses, crisp cel shading, kinetic linework', avoid:['recognizable existing anime character','copied hairstyle','copied costume or insignia'] },
];

function adaptNamedStyles(positive, negative) {
  let out = String(positive || '');
  const avoid = [];
  let adapted = false;
  for (const row of NAMED_STYLE_MAP) {
    row.re.lastIndex = 0;
    if (row.re.test(out)) {
      row.re.lastIndex = 0;
      out = out.replace(row.re, row.replacement);
      avoid.push(...row.avoid);
      adapted = true;
    }
    row.re.lastIndex = 0;
  }
  if (adapted) out += ', ORIGINALITY LOCK: preserve the broad visual language and mood while creating a new subject identity; do not reproduce a recognizable existing character, face, costume, logo, symbol, mascot silhouette, or franchise-specific identity';
  return { positive: clean(out, 16000), negative: uniq([negative, ...avoid], 80).join(', '), adapted, avoid:uniq(avoid,40) };
}

function detectPurpose(text) {
  const source = oneLine(text, 10000);
  if (/\b(tattoo|tatuaje|stencil de tatuaje|diseño para tatuaje)\b/i.test(source)) return 'tattoo';
  if (/\b(sticker|pegatina|calcoman[ií]a)\b/i.test(source)) return 'sticker';
  if (/\b(logo|logotipo|brand mark|marca gr[aá]fica)\b/i.test(source)) return 'logo';
  if (/\b(product photo|foto de producto|ecommerce|e-commerce)\b/i.test(source)) return 'product';
  if (/\b(game character|personaje de videojuego|videojuego)\b/i.test(source)) return 'game_character';
  return 'general';
}

function purposeDirectives(purpose) {
  if (purpose === 'tattoo') return { positive:['tattoo-ready composition','strong readable silhouette','clean line hierarchy','controlled detail','clear anatomy','high contrast','minimal visual clutter'], negative:['busy background','muddy details','weak silhouette','tiny unreadable ornament','photographic background clutter'] };
  if (purpose === 'sticker') return { positive:['clean isolated sticker-friendly silhouette','bold readable contour','clear edge separation'], negative:['busy background','weak silhouette','cropped subject'] };
  if (purpose === 'logo') return { positive:['logo-ready simplicity','strong iconic silhouette','scalable clean shapes','minimal unnecessary detail'], negative:['photographic clutter','busy background','tiny unreadable detail'] };
  if (purpose === 'product') return { positive:['clean product-focused composition','accurate product geometry','commercial clarity'], negative:['distorted product shape','clutter hiding product'] };
  if (purpose === 'game_character') return { positive:['clear game-character silhouette','coherent costume design','readable full-body character design'], negative:['character sheet unless requested','multiple unrelated poses'] };
  return { positive:[], negative:[] };
}

function removeNegativeConflicts(negative, style, positive) {
  const tokens = String(negative || '').split(/[,;\n]/).map(x=>oneLine(x,300)).filter(Boolean);
  const positiveLower = String(positive || '').toLowerCase();
  return tokens.filter(token => {
    const t = token.toLowerCase();
    if (style === 'anime' && /\b(anime|manga|cel shading|cartoon)\b/.test(t)) return false;
    if (style === 'cartoon' && /\b(cartoon|animated|family animation)\b/.test(t)) return false;
    if (style === 'photorealistic' && /\b(realistic|realista|photoreal|foto realista|cinematic)\b/.test(t)) return false;
    if (style === '3d_animation' && /\b(3d|cgi|render)\b/.test(t)) return false;
    const words = t.split(/\s+/).filter(w=>w.length>4);
    if (words.length === 1 && positiveLower.includes(words[0]) && /(?:color|hair|cabello|ropa|outfit|background|fondo)/.test(t)) return false;
    return true;
  }).join(', ');
}

function extractCorePositive(value) {
  let text = clean(value, 15000);
  text = text
    .replace(/^\s*(?:generame|genérame|genera|creame|créame|crea|hazme|haz|generate|create|make)\s+(?:una|un|an|a)?\s*(?:imagen|image|foto|photo|render|ilustraci[oó]n|illustration)?\s*/i, '')
    .replace(/^\s*(?:con\s+)?resoluci[oó]n\s+(?:4\s*k|2\s*k|1080\s*p|\d{3,4}\s*[x×]\s*\d{3,4})\s+(?:de|of)\s+/i, '')
    .replace(/^\s*(?:de|of)\s+/i, '')
    .trim();
  return text || clean(value,15000);
}

function targetStyleDirectives(style) {
  if (style === 'photorealistic') return { positive:['STRICT STYLE LOCK: photorealistic grounded realism','physically believable materials and lighting','documentary/cinematic photographic realism','natural perspective and texture','not illustration'], negative:['anime','manga','cartoon','cel shading','flat illustration','stylized drawing','painterly anime look','game-art render'] };
  if (style === 'anime') return { positive:['STRICT STYLE LOCK: coherent anime illustration','clean line art','controlled cel shading'], negative:['photorealistic skin','live-action photography','mixed realistic rendering'] };
  if (style === 'cartoon') return { positive:['STRICT STYLE LOCK: polished cartoon/family-animation illustration','clean appealing shapes','consistent stylized rendering'], negative:['photorealistic live-action look','mixed rendering styles'] };
  if (style === '3d_animation') return { positive:['STRICT STYLE LOCK: polished stylized 3D animation','coherent 3D materials and lighting'], negative:['flat 2D anime line art','photographic live-action look'] };
  return { positive:[], negative:[] };
}

function requirementGraph(positive, technical, purpose, style, similarityAdapted) {
  const p = oneLine(positive, 15000);
  const requirements = [];
  const push = (id, label, critical = true) => requirements.push({ id, label:oneLine(label,420), critical });
  const patterns = [
    ['full_body', /\b(cuerpo completo|full body|head to toe|de pies a cabeza)\b/i, 'full body visible head-to-toe'],
    ['dynamic_action', /\b(pose din[aá]mica|dynamic pose|fighting pose|pose de lucha|battle|batalla|combat|combate|running|corriendo|jumping|saltando|puños? levantados?|fists? raised)\b/i, 'requested dynamic pose/action is clearly readable'],
    ['modern_outfit', /\b(ropa moderna|modern outfit|form-fitting|ajustad[oa] al cuerpo|armor|armadura|chaqueta|jacket|boots|botas)\b/i, 'requested clothing/outfit remains visibly present'],
    ['markings', /\b(marcas?|markings?|tatuajes?|tattoos?|geometric lines|líneas geométricas|indigenous marks|marcas ind[ií]genas)\b/i, 'requested markings/symbolic body details are clearly visible'],
    ['environment', /\b(city|ciudad|urban|urbano|war-torn|guerra|ruins?|ruinas|buildings?|edificios|neon|ne[oó]n|smoke|humo|park|parque|forest|bosque|beach|playa)\b/i, 'requested environment/background is visibly recognizable'],
  ];
  for (const [id,re,label] of patterns) if (re.test(p)) push(id,label,true);
  if (style !== 'auto') push('style',`requested visual style must clearly read as ${style}`,true);
  if (purpose !== 'general') push('purpose',`final design must remain suitable for ${purpose}`,true);
  if (technical.transparent) push('transparent','final delivered file must have a transparent background / alpha channel',true);
  if (technical.wants4k || technical.wants2k || technical.wants1080 || technical.exactWidth) push('resolution','final delivered file must satisfy the requested output resolution',true);
  if (similarityAdapted) push('originality','subject must be an original design, not a recognizable existing franchise character/mascot',true);
  return requirements;
}

function chooseTargetDimensions(spec, currentWidth, currentHeight, context = {}) {
  const cw = Math.max(1, Number(currentWidth) || 1024);
  const ch = Math.max(1, Number(currentHeight) || 1024);
  if (spec.exactWidth && spec.exactHeight) return { width:spec.exactWidth, height:spec.exactHeight, exact:true, label:`${spec.exactWidth}x${spec.exactHeight}` };
  let longEdge = spec.wants4k ? 3840 : spec.wants2k ? 2560 : spec.wants1080 ? 1920 : 0;
  if (!longEdge) return null;
  let width, height;
  const defaultVertical = Boolean(spec.vertical || (!spec.horizontal && !spec.square && spec.fullBody));
  const defaultHorizontal = Boolean(spec.horizontal || (!spec.vertical && !spec.square && !spec.fullBody));
  if (spec.square) {
    width = height = longEdge;
  } else if (spec.wants4k && !spec.exactWidth && !spec.exactHeight && !spec.vertical && !spec.horizontal) {
    if (defaultVertical) { width = 2160; height = 3840; }
    else { width = 3840; height = 2160; }
  } else if (defaultVertical) {
    height = longEdge;
    width = Math.max(64, Math.round((ch ? cw / ch : 9 / 16) * height / 8) * 8);
  } else if (defaultHorizontal) {
    width = longEdge;
    height = Math.max(64, Math.round((ch / cw) * width / 8) * 8);
  } else if (cw >= ch) {
    width = longEdge;
    height = Math.max(64, Math.round((ch / cw) * width / 8) * 8);
  } else {
    height = longEdge;
    width = Math.max(64, Math.round((cw / ch) * height / 8) * 8);
  }
  return { width, height, exact:false, label:spec.wants4k?'4K-target':spec.wants2k?'2K-target':'1080-target' };
}

function classifyCheckpoint(name) {
  const value = String(name || '').toLowerCase();
  if (!value) return 'general';
  if (/(anime|manga|animagine|anything|counterfeit|pastel|meina|hassaku|toon|cartoon)/.test(value)) return 'anime';
  if (/(real|realistic|realvis|juggernaut|epicrealism|photoreal|dreamshaper xl turbo photoreal|zavy|absolute_reality|cyberrealistic)/.test(value)) return 'photorealistic';
  if (/(3d|pixar|cgi)/.test(value)) return '3d_animation';
  return 'general';
}

function extractConfiguredCheckpoint(settings = {}) {
  const keys = ['comfyCheckpoint','checkpointComfyUI','checkpoint','sdxlCheckpoint','defaultCheckpoint','comfyModel'];
  for (const key of keys) {
    const value = oneLine(settings[key] || '', 300);
    if (value) return value;
  }
  return '';
}

async function listComfyCheckpoints(baseUrl) {
  const cleanBase = String(baseUrl || 'http://127.0.0.1:8188').replace(/\/$/, '');
  const attempts = [
    async()=>{
      const info = await requestJson('GET', cleanBase + '/object_info/CheckpointLoaderSimple', null, 15000);
      const list = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || info?.input?.required?.ckpt_name?.[0] || [];
      return Array.isArray(list) ? list : [];
    },
    async()=>{
      const info = await requestJson('GET', cleanBase + '/object_info', null, 20000);
      const list = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
      return Array.isArray(list) ? list : [];
    },
    async()=>{
      const info = await requestJson('GET', cleanBase + '/models/checkpoints', null, 15000);
      return Array.isArray(info) ? info : Array.isArray(info?.models) ? info.models : [];
    },
  ];
  for (const run of attempts) {
    try {
      const list = uniq(await run(), 200);
      if (list.length) return list;
    } catch (_) {}
  }
  return [];
}

function chooseCheckpointForStyle(style, checkpoints, configured) {
  const list = uniq(checkpoints, 200);
  const explicit = oneLine(configured || '', 300);
  if (explicit) {
    const exact = list.find(x => String(x).toLowerCase() === explicit.toLowerCase()) || explicit;
    return { resolvedCheckpoint: exact, source: 'settings', family: classifyCheckpoint(exact), checkpoints: list };
  }
  if (!list.length) return { resolvedCheckpoint: '', source: 'unknown', family: 'unknown', checkpoints: list };
  const desired = style === 'auto' ? 'general' : style;
  const scored = list.map(name => {
    const family = classifyCheckpoint(name);
    let score = 0;
    if (family === desired) score += 100;
    if (desired === 'photorealistic' && family === 'general') score += 50;
    if (desired === 'anime' && family === 'general') score += 35;
    if (desired === 'cartoon' && /toon|cartoon|pixar/i.test(String(name))) score += 95;
    if (desired === '3d_animation' && family === '3d_animation') score += 100;
    if (family === 'general') score += 10;
    return { name, family, score };
  }).sort((a,b)=>b.score-a.score || String(a.name).localeCompare(String(b.name)));
  const best = scored[0];
  return { resolvedCheckpoint: best?.name || list[0], source: 'auto-router', family: best?.family || 'general', checkpoints: list, ranked: scored.slice(0,10) };
}

async function inspectComfyRuntime(settings = {}) {
  const configuredCheckpoint = extractConfiguredCheckpoint(settings);
  const checkpoints = await listComfyCheckpoints(settings.comfyBaseUrl || 'http://127.0.0.1:8188');
  const selected = chooseCheckpointForStyle('auto', checkpoints, configuredCheckpoint);
  return {
    version: VERSION,
    comfyBaseUrl: String(settings.comfyBaseUrl || 'http://127.0.0.1:8188'),
    configuredCheckpoint,
    checkpointCount: checkpoints.length,
    availableCheckpoints: checkpoints,
    activeCheckpointGuess: selected.resolvedCheckpoint || configuredCheckpoint || checkpoints[0] || '',
    activeCheckpointFamily: selected.family,
  };
}

function buildStyleAuthority(prepared) {
  const forbidden = [];
  if (prepared.style === 'photorealistic') forbidden.push('anime','manga','cartoon','illustration');
  if (prepared.style === 'anime') forbidden.push('photorealistic live-action style');
  if (prepared.style === 'cartoon') forbidden.push('photorealistic live-action style');
  return { requestedStyle: prepared.style, forbiddenStyles: uniq(forbidden, 20) };
}

function prepareRequest(userRequest) {
  const sections = splitPromptSections(userRequest);
  const technical = extractTechnicalSpec(sections.positive);
  let positive = extractCorePositive(sections.positive);
  let negative = sections.negative;
  const styleBefore = detectStyle(positive);
  negative = removeNegativeConflicts(negative, styleBefore, positive);
  const adapted = adaptNamedStyles(positive, negative);
  positive = adapted.positive; negative = adapted.negative;
  const style = detectStyle(positive) !== 'auto' ? detectStyle(positive) : styleBefore;
  const purpose = detectPurpose(positive + ' ' + userRequest);
  const profile = purposeDirectives(purpose);
  const styleRules = targetStyleDirectives(style);
  const positives = [positive, ...profile.positive, ...styleRules.positive];
  const negatives = [negative, ...profile.negative, ...styleRules.negative];

  if (technical.fullBody) positives.push('full body entirely visible, head to toe inside frame, both feet visible, comfortable margin around subject');
  if (technical.transparent) {
    positives.push('INTERMEDIATE TRANSPARENCY PLATE: isolate the subject against a perfectly flat uniform pure chroma green #00FF00 background, edge-to-edge, no scenery, no floor, no shadows on the background, no gradient; Nexa will remove this plate into real alpha transparency after rendering');
    negatives.push('complex background','scenery','gradient background','textured background','background shadows','floor shadow','objects behind subject');
  }
  if (technical.wants4k || technical.wants2k || technical.wants1080 || technical.exactWidth) positives.push('preserve crisp edges and detail suitable for high-resolution final upscaling');
  positives.push('CONSTRAINT FUSION: every explicit requested subject trait, role, outfit, pose, environment, style and output requirement must coexist; do not keep only the easiest or prettiest subset');
  negatives.push('prompt drift','dropped requested attribute','single-trait simplification','ignored explicit requirement');

  const graph = requirementGraph(positive, technical, purpose, style, adapted.adapted);
  const hard = graph.filter(x=>x.critical).map(x=>x.label);
  const prepared = {
    version:VERSION,
    originalRequest:clean(userRequest,20000),
    positive:uniq(positives,100).join(', '),
    negative:uniq(negatives,100).join(', '),
    technical,
    style,
    purpose,
    similarityAdapted:adapted.adapted,
    originalityAvoid:adapted.avoid,
    requirements:graph,
  };
  const authority = buildStyleAuthority(prepared);
  prepared.styleAuthority = authority;
  prepared.generationRequest = [
    'NEXA IMAGE INTELLIGENCE v1.9.8',
    `STYLE AUTHORITY: ${authority.requestedStyle}${authority.forbiddenStyles.length ? ' | forbidden: ' + authority.forbiddenStyles.join(', ') : ''}`,
    `CLEAN VISUAL REQUEST: ${prepared.positive}`,
    `CLEAN NEGATIVE REQUIREMENTS: ${prepared.negative}`,
    `STYLE TARGET: ${style}`,
    `PURPOSE PROFILE: ${purpose}`,
    `HARD REQUIREMENTS: ${hard.join(' | ') || 'preserve the complete user request'}`,
    technical.wants4k ? `OUTPUT TARGET: 4K exact target requested (${technical.fullBody ? 'prefer 2160x3840 for full body' : 'prefer 3840x2160 unless user requested another orientation'})` : '',
  ].filter(Boolean).join('\n');
  return prepared;
}

async function prepareRuntimePlan(userRequest, settings = {}, progress) {
  const prepared = prepareRequest(userRequest);
  const configuredCheckpoint = extractConfiguredCheckpoint(settings);
  const checkpoints = await listComfyCheckpoints(settings.comfyBaseUrl || 'http://127.0.0.1:8188').catch(()=>[]);
  const route = chooseCheckpointForStyle(prepared.style, checkpoints, configuredCheckpoint);
  prepared.runtime = {
    version: VERSION,
    comfyBaseUrl: String(settings.comfyBaseUrl || 'http://127.0.0.1:8188'),
    configuredCheckpoint,
    resolvedCheckpoint: route.resolvedCheckpoint || '',
    checkpointSource: route.source,
    checkpointFamily: route.family,
    availableCheckpoints: route.checkpoints || checkpoints,
    rankedCheckpoints: route.ranked || [],
  };
  prepared.highResolutionPlan = HighRes.chooseHighResolutionPlan(prepared.technical, 1024, 1024, prepared, chooseTargetDimensions);
  if (progress) {
    const family = prepared.runtime.checkpointFamily || 'unknown';
    const source = prepared.runtime.checkpointSource || 'unknown';
    const model = prepared.runtime.resolvedCheckpoint || '(sin detectar)';
    progress(`Comfy Model Inspector: checkpoint ${model} · familia ${family} · fuente ${source}`);
    if (prepared.highResolutionPlan?.requested) {
      const hp = prepared.highResolutionPlan;
      progress(`High-Resolution 4K Pipeline: refine ${hp.stage1.width}×${hp.stage1.height} → exact-scale ${hp.stage2.width}×${hp.stage2.height}`);
    }
  }
  prepared.generationRequest = [
    prepared.generationRequest,
    `COMFY CHECKPOINT DECISION: ${prepared.runtime.resolvedCheckpoint || 'not-detected'} (${prepared.runtime.checkpointFamily || 'unknown'}, ${prepared.runtime.checkpointSource || 'unknown'})`,
    prepared.highResolutionPlan?.requested ? `HIGH-RES PIPELINE: stage1 ${prepared.highResolutionPlan.stage1.width}x${prepared.highResolutionPlan.stage1.height} latent refine | stage2 ${prepared.highResolutionPlan.stage2.width}x${prepared.highResolutionPlan.stage2.height} exact-scale` : '',
  ].join('\n');
  return prepared;
}

function installCompiler(Compiler) {
  if (!Compiler || Compiler.__nexaImageIntelligenceV198) return Compiler;
  const originalCompile = Compiler.compile.bind(Compiler);
  Compiler.compile = function(userRequest, opts = {}) {
    const prepared = prepareRequest(userRequest);
    const base = originalCompile(prepared.positive, opts);
    const hard = uniq([...(base.hardRequirements || []), ...prepared.requirements.filter(x=>x.critical).map(x=>x.label)], 80);
    return {
      ...base,
      original:prepared.originalRequest,
      positivePrompt:uniq([base.positivePrompt, prepared.positive],120).join(', '),
      negativePrompt:uniq([base.negativePrompt, prepared.negative],120).join(', '),
      hardRequirements:hard,
      style:prepared.style === 'auto' ? base.style : prepared.style,
      imageIntelligence:{ version:VERSION, technical:prepared.technical, style:prepared.style, purpose:prepared.purpose, requirements:prepared.requirements, similarityAdapted:prepared.similarityAdapted, styleAuthority:prepared.styleAuthority },
    };
  };
  Compiler.__nexaImageIntelligenceV198 = true;
  return Compiler;
}

function installRouting(Routing) {
  if (!Routing || Routing.__nexaImageIntelligenceV198) return Routing;
  const oldExplicit = Routing.looksLikeExplicitImageRequest?.bind(Routing);
  Routing.looksLikeExplicitImageRequest = value => Boolean(oldExplicit?.(value) || isVisualCreationIntent(value));
  Routing.shouldGenerateImage = (value, hasImage = false) => Routing.looksLikeExplicitImageRequest(value) || Boolean(Routing.looksLikeNaturalReferenceGeneration?.(value, hasImage));
  Routing.__nexaImageIntelligenceV198 = true;
  return Routing;
}

function state(value) {
  const s = String(value || '').toLowerCase();
  return ['pass','fail','uncertain','na'].includes(s) ? s : 'uncertain';
}

function installVisualReview(V) {
  if (!V || V.__nexaImageIntelligenceV198) return V;
  const oldEvaluationPrompt = V.evaluationPrompt.bind(V);
  const oldFinalize = V.finalizeEvaluation.bind(V);
  const oldRepairs = V.applyRepairs.bind(V);
  const oldSummary = V.summary.bind(V);

  V.evaluationPrompt = function(userRequest, plan, attempt) {
    const prepared = prepareRequest(userRequest);
    const checklist = prepared.requirements.map((r,i)=>`${i+1}. ${r.label} [${r.critical?'CRITICAL':'SOFT'}]`).join('\n');
    return oldEvaluationPrompt(userRequest, plan, attempt) + '\n\nNEXA IMAGE INTELLIGENCE v1.9.8 — STRICT REQUIREMENT REVIEW:\n' +
      'Evaluate the generated image against EVERY requirement below, not just overall beauty. A visually attractive image is NOT correct if it drops an explicit requirement.\n' +
      'If the request asks for photorealism and the result is anime/cartoon/illustration, set style=fail and include E007.\n' +
      'If the request asks for full body and feet/body are cropped, set framing=fail and include E017.\n' +
      'If a requested action/pose is missing or becomes static, set pose_action=fail and include E016.\n' +
      'If a requested important attribute/marking/outfit element is not clearly visible, set requested_attributes=fail and include E010.\n' +
      'If an original style-adapted request produces a recognizable existing franchise character/mascot rather than an original character, set subject_identity=fail and include E001.\n' +
      'If the image style or content only satisfies a subset of the prompt while dropping another required dimension, treat this as prompt drift and fail the relevant requirement.\n' +
      `REQUESTED STYLE TARGET: ${prepared.style}. PURPOSE: ${prepared.purpose}.\n` +
      'REQUIREMENT CHECKLIST:\n' + (checklist || '- preserve the complete explicit request');
  };

  V.finalizeEvaluation = function(raw, userRequest, threshold) {
    const prepared = prepareRequest(userRequest);
    const result = oldFinalize(raw, userRequest, threshold);
    const codes = new Set(result.error_codes || []);
    const critical = new Set(result.critical_errors || []);
    const require = id => prepared.requirements.some(x=>x.id===id && x.critical);
    if (prepared.style !== 'auto' && state(result.style) === 'fail') { codes.add('E007'); critical.add('E007'); }
    if (require('full_body') && state(result.framing) === 'fail') { codes.add('E017'); critical.add('E017'); }
    if (require('dynamic_action') && state(result.pose_action) === 'fail') { codes.add('E016'); critical.add('E016'); }
    if ((require('markings') || require('modern_outfit')) && state(result.requested_attributes) === 'fail') { codes.add('E010'); critical.add('E010'); }
    if (prepared.similarityAdapted && state(result.subject_identity) === 'fail') { codes.add('E001'); critical.add('E001'); }

    const uncertainCritical = [
      prepared.style !== 'auto' ? state(result.style) : 'na',
      require('full_body') ? state(result.framing) : 'na',
      require('dynamic_action') ? state(result.pose_action) : 'na',
      (require('markings') || require('modern_outfit')) ? state(result.requested_attributes) : 'na',
    ].some(x=>x==='uncertain');
    let score = Number(result.score || 0);
    if (critical.size > 0 && score > 74) score = 74;
    if (uncertainCritical && score > 84) score = 84;
    const pass = critical.size === 0 && !uncertainCritical && score >= Number(result.threshold || threshold || 78);
    return { ...result, score, error_codes:[...codes], critical_errors:[...critical], critical:critical.size>0, pass, imageIntelligence:{version:VERSION,styleTarget:prepared.style,requirements:prepared.requirements,uncertainCritical} };
  };

  V.applyRepairs = function(plan, evaluation, userRequest, nextAttempt) {
    const prepared = prepareRequest(userRequest);
    const repaired = oldRepairs(plan, evaluation, userRequest, nextAttempt);
    const errors = new Set(evaluation?.error_codes || []);
    const pos = [repaired.positive_prompt || repaired.positivePrompt || '', prepared.positive];
    const neg = [repaired.negative_prompt || repaired.negativePrompt || '', prepared.negative];
    if (errors.has('E007')) {
      const lock = targetStyleDirectives(prepared.style);
      pos.push('STYLE REPAIR: rebuild the rendering in the requested style; do not preserve the failed rendering style', ...lock.positive);
      neg.push(...lock.negative, 'previous failed style');
    }
    if (errors.has('E016')) pos.push('ACTION REPAIR: rebuild body language and camera composition around the requested action; make the action obvious without reading the prompt');
    if (errors.has('E017')) pos.push('FRAMING REPAIR: show the entire requested framing; for full body keep head, hands and both feet inside frame with margin');
    if (errors.has('E010')) pos.push('ATTRIBUTE REPAIR: make every explicitly requested marking, clothing item, gear and identity detail clearly visible and unobstructed');
    if (errors.has('E001') && prepared.similarityAdapted) {
      pos.push('ORIGINALITY REPAIR: redesign face, silhouette, hair, clothing and accessories into a new original character while preserving only broad style language');
      neg.push(...prepared.originalityAvoid, 'recognizable existing franchise character','mascot identity shortcut');
    }
    if (Number(nextAttempt) >= 3) {
      pos.push('ESCALATION RETRY: rebuild composition from the hard requirements instead of making a minor variation of the previous failed image');
      neg.push('same failed composition','same failed pose','same failed style shortcut');
    }
    return { ...repaired, positive_prompt:uniq(pos,140).join(', '), negative_prompt:uniq(neg,140).join(', '), imageIntelligenceRepair:true };
  };

  V.summary = function(evaluation, attempts) {
    const base = oldSummary(evaluation, attempts);
    if (evaluation?.critical_errors?.length) return `${base} · requisitos críticos pendientes: ${evaluation.critical_errors.join(', ')}`;
    if (evaluation?.imageIntelligence?.uncertainCritical) return `${base} · requisito crítico no confirmado`;
    return base;
  };

  V.__nexaImageIntelligenceV198 = true;
  return V;
}

function transport(url) { return url.protocol === 'https:' ? https : http; }
function requestJson(method, urlString, body, timeoutMs = 30000) {
  return new Promise((resolve,reject)=>{
    const url = new URL(urlString);
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = transport(url).request({method,hostname:url.hostname,port:url.port||(url.protocol==='https:'?443:80),path:url.pathname+url.search,headers:payload?{'Content-Type':'application/json','Content-Length':payload.length}:{}},res=>{
      let raw='';res.setEncoding('utf8');res.on('data',c=>raw+=c);res.on('end',()=>{
        if(res.statusCode<200||res.statusCode>=300)return reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0,700)}`));
        try{resolve(raw.trim()?JSON.parse(raw):{});}catch(e){reject(e);}
      });
    });
    req.setTimeout(timeoutMs,()=>req.destroy(new Error('Timeout')));req.on('error',reject);if(payload)req.write(payload);req.end();
  });
}
function requestBuffer(method, urlString, timeoutMs = 120000) {
  return new Promise((resolve,reject)=>{
    const url=new URL(urlString);const req=transport(url).request({method,hostname:url.hostname,port:url.port||(url.protocol==='https:'?443:80),path:url.pathname+url.search},res=>{
      const chunks=[];res.on('data',c=>chunks.push(Buffer.isBuffer(c)?c:Buffer.from(c)));res.on('end',()=>{const b=Buffer.concat(chunks);if(res.statusCode<200||res.statusCode>=300)return reject(new Error(`HTTP ${res.statusCode}`));resolve(b);});
    });req.setTimeout(timeoutMs,()=>req.destroy(new Error('Timeout')));req.on('error',reject);req.end();
  });
}
function uploadImage(baseUrl, filePath, uploadName) {
  return new Promise((resolve,reject)=>{
    const url=new URL(String(baseUrl).replace(/\/$/,'')+'/upload/image');
    const boundary='----NexaV196'+Date.now().toString(16);
    const raw=fs.readFileSync(filePath);
    const name=String(uploadName||path.basename(filePath)).replace(/[^a-zA-Z0-9._-]/g,'_');
    const parts=[];const push=s=>parts.push(Buffer.from(s,'utf8'));
    push(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`);parts.push(raw);push('\r\n');
    push(`--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\ninput\r\n`);
    push(`--${boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n`);
    push(`--${boundary}--\r\n`);const body=Buffer.concat(parts);
    const req=transport(url).request({method:'POST',hostname:url.hostname,port:url.port||(url.protocol==='https:'?443:80),path:url.pathname,headers:{'Content-Type':`multipart/form-data; boundary=${boundary}`,'Content-Length':body.length}},res=>{let t='';res.setEncoding('utf8');res.on('data',c=>t+=c);res.on('end',()=>{if(res.statusCode<200||res.statusCode>=300)return reject(new Error(`upload HTTP ${res.statusCode}: ${t.slice(0,500)}`));try{resolve(t.trim()?JSON.parse(t):{name});}catch(_){resolve({name});}});});
    req.on('error',reject);req.write(body);req.end();
  });
}
function collectImages(entry) { const out=[]; for(const node of Object.values(entry?.outputs||{})) if(Array.isArray(node?.images))out.push(...node.images); return out; }
async function upscaleWithComfy(filePath, baseUrl, width, height, requestId, progress) {
  const cleanBase=String(baseUrl||'http://127.0.0.1:8188').replace(/\/$/,'');
  const upload=await uploadImage(cleanBase,filePath,`nexa-v198-${requestId}.png`);
  const inputName=String(upload?.name||upload?.filename||`nexa-v198-${requestId}.png`);
  const workflow={
    '1':{class_type:'LoadImage',inputs:{image:inputName}},
    '2':{class_type:'ImageScale',inputs:{image:['1',0],upscale_method:'lanczos',width:Number(width),height:Number(height),crop:'disabled'}},
    '3':{class_type:'SaveImage',inputs:{filename_prefix:'NexaAI-v198-upscale',images:['2',0]}},
  };
  progress?.(`Escalando salida a ${width}×${height} con paciencia ampliada…`);
  const queued=await requestJson('POST',cleanBase+'/prompt',{prompt:workflow,client_id:`nexa-v198-${requestId}`},20000);
  const promptId=queued?.prompt_id;if(!promptId)throw new Error('ComfyUI no devolvió prompt_id para upscale.');
  const started=Date.now();let meta=null;
  while(Date.now()-started<900000){
    const hist=await requestJson('GET',cleanBase+'/history/'+encodeURIComponent(promptId),null,30000);const entry=hist?.[promptId]||hist;const imgs=collectImages(entry);if(imgs.length){meta=imgs[0];break;}await new Promise(r=>setTimeout(r,1200));
  }
  if(!meta)throw new Error('ComfyUI no terminó el upscale dentro del tiempo ampliado.');
  const q=new URLSearchParams({filename:String(meta.filename||''),subfolder:String(meta.subfolder||''),type:String(meta.type||'output')});
  const buffer=await requestBuffer('GET',cleanBase+'/view?'+q.toString(),120000);
  const dest=path.join(path.dirname(filePath),path.basename(filePath,path.extname(filePath))+'-upscaled.png');fs.writeFileSync(dest,buffer);return dest;
}

function applyChromaTransparency(filePath) {
  let electron;
  try { electron=require('electron'); } catch (_) { return {applied:false,path:filePath,reason:'electron-nativeImage-unavailable'}; }
  const nativeImage=electron.nativeImage;
  if(!nativeImage) return {applied:false,path:filePath,reason:'nativeImage-unavailable'};
  const img=nativeImage.createFromPath(filePath);const size=img.getSize();if(!size.width||!size.height)return{applied:false,path:filePath,reason:'image-load-failed'};
  const bitmap=Buffer.from(img.toBitmap());const w=size.width,h=size.height;if(bitmap.length<w*h*4)return{applied:false,path:filePath,reason:'bitmap-format'};
  let greenish=0, cornerCount=0;
  const cornerSamples=[];
  const sample=(x,y)=>{const i=(y*w+x)*4;const b=bitmap[i],g=bitmap[i+1],r=bitmap[i+2];cornerSamples.push([r,g,b]);cornerCount++;if(g>120&&g>r*1.25&&g>b*1.25)greenish++;};
  const pts=[[2,2],[w-3,2],[2,h-3],[w-3,h-3],[Math.floor(w/2),2],[Math.floor(w/2),h-3]];
  for(const [x0,y0] of pts){const x=Math.max(0,Math.min(w-1,x0)),y=Math.max(0,Math.min(h-1,y0));sample(x,y);}
  if(greenish<Math.max(3,Math.floor(cornerCount*.5)))return{applied:false,path:filePath,reason:'chroma-background-not-detected'};
  const avg=cornerSamples.reduce((a,c)=>[a[0]+c[0],a[1]+c[1],a[2]+c[2]],[0,0,0]).map(v=>v/cornerSamples.length);
  let transparentPixels=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=(y*w+x)*4,b=bitmap[i],g=bitmap[i+1],r=bitmap[i+2];const d=Math.sqrt((r-avg[0])**2+(g-avg[1])**2+(b-avg[2])**2);const green=g>105&&g>r*1.18&&g>b*1.18;
    if(green&&d<95){const a=d<45?0:Math.round(255*(d-45)/50);bitmap[i+3]=Math.max(0,Math.min(255,a));transparentPixels++;}
  }
  if(transparentPixels < w*h*0.02)return{applied:false,path:filePath,reason:'insufficient-background-mask'};
  const output=nativeImage.createFromBitmap(bitmap,{width:w,height:h,scaleFactor:1});const dest=path.join(path.dirname(filePath),path.basename(filePath,path.extname(filePath))+'-transparent.png');fs.writeFileSync(dest,output.toPNG());return{applied:true,path:dest,transparentPixels,width:w,height:h};
}

function readImageSize(filePath, fallback = {}) {
  try { const electron=require('electron'); const img=electron.nativeImage?.createFromPath(filePath); const s=img?.getSize?.(); if(s?.width&&s?.height)return s; } catch (_) {}
  return {width:Number(fallback.width)||0,height:Number(fallback.height)||0};
}

async function finalizeOutput(result, prepared, settings = {}, progress) {
  if(!result?.image?.path || !fs.existsSync(result.image.path)) return result;
  let current=result.image.path;
  const validation={requested:prepared.technical,upscale:{requested:false,applied:false},highResolutionPipeline:{requested:false,applied:false},transparency:{requested:prepared.technical.transparent,applied:false},checkpoint:prepared.runtime||null,errors:[]};
  const currentSize=readImageSize(current,result.image);
  const target=chooseTargetDimensions(prepared.technical,currentSize.width,currentSize.height,prepared);
  const highResPlan = prepared.highResolutionPlan || HighRes.chooseHighResolutionPlan(prepared.technical,currentSize.width,currentSize.height,prepared,chooseTargetDimensions);
  if(highResPlan?.requested && target && (currentSize.width<target.width || currentSize.height<target.height || target.exact)) {
    validation.upscale.requested=true;validation.upscale.target=target;
    validation.highResolutionPipeline.requested=true;validation.highResolutionPipeline.plan=highResPlan;
    try {
      const pipeline = await HighRes.runHighResolutionPipeline({ filePath:current, baseUrl:settings.comfyBaseUrl||'http://127.0.0.1:8188', prepared, requestId:result.requestId||'img', progress, readImageSize, requestJson, requestBuffer, uploadImage, collectImages, clean, chooseTargetDimensions });
      current = pipeline.path;
      validation.upscale.applied = true;
      validation.highResolutionPipeline.applied = true;
      validation.highResolutionPipeline.mode = highResPlan.mode;
      validation.highResolutionPipeline.stages = pipeline.stages;
      if(pipeline.refineError) validation.highResolutionPipeline.refineFallback = pipeline.refineError;
    } catch(e) {
      validation.errors.push('high-resolution-pipeline: '+String(e?.message||e));
      try { current=await upscaleWithComfy(current,settings.comfyBaseUrl||'http://127.0.0.1:8188',target.width,target.height,result.requestId||'img',progress);validation.upscale.applied=true;validation.highResolutionPipeline.fallback='lanczos-only'; }
      catch(scaleError){validation.errors.push('upscale: '+String(scaleError?.message||scaleError));}
    }
  }
  if(prepared.technical.transparent){
    const trans=applyChromaTransparency(current);validation.transparency={requested:true,...trans};if(trans.applied)current=trans.path;else validation.errors.push('transparency: '+trans.reason);
  }
  const finalSize=readImageSize(current,result.image);validation.finalSize=finalSize;
  if(target && (finalSize.width<target.width || finalSize.height<target.height)) validation.errors.push(`resolution-not-met:${finalSize.width}x${finalSize.height}`);
  if(prepared.technical.transparent && !validation.transparency.applied) validation.errors.push('transparent-background-not-met');
  validation.pass=validation.errors.length===0;
  result.image={...result.image,path:current,fileName:path.basename(current),width:finalSize.width||result.image.width,height:finalSize.height||result.image.height,outputValidation:validation,requestedStyle:prepared.style,purposeProfile:prepared.purpose,checkpointRouting:prepared.runtime||null};
  result.outputValidation=validation;result.imageIntelligence={version:VERSION,style:prepared.style,purpose:prepared.purpose,requirements:prepared.requirements,output:prepared.technical,checkpoint:prepared.runtime||null};
  if(result.evaluation && !validation.pass){result.evaluation={...result.evaluation,pass:false,outputValidation:validation};result.image.evaluationStatus='BEST_AVAILABLE';}
  const tech=[];
  if(validation.highResolutionPipeline.applied) tech.push(`High-Resolution 4K Pipeline completado`); else if(validation.upscale.applied) tech.push(`escalado exacto aplicado`);
  if(validation.transparency.applied) tech.push('fondo transparente real');
  if(prepared.runtime?.resolvedCheckpoint) tech.push(`checkpoint ${prepared.runtime.resolvedCheckpoint}`);
  if(validation.finalSize?.width && validation.finalSize?.height) tech.push(`${validation.finalSize.width}×${validation.finalSize.height}`);
  if(!validation.pass) tech.push('salida técnica parcial');
  if(tech.length) result.summary=String(result.summary||'Imagen generada.')+' · Nexa Output: '+tech.join(' · ');
  return result;
}

module.exports={
  VERSION,clean,uniq,isVisualCreationIntent,splitPromptSections,extractTechnicalSpec,detectStyle,adaptNamedStyles,detectPurpose,purposeDirectives,removeNegativeConflicts,requirementGraph,chooseTargetDimensions,prepareRequest,prepareRuntimePlan,inspectComfyRuntime,listComfyCheckpoints,chooseCheckpointForStyle,classifyCheckpoint,installCompiler,installRouting,installVisualReview,finalizeOutput,applyChromaTransparency,chooseHighResolutionPlan: (spec,currentWidth,currentHeight,context={}) => HighRes.chooseHighResolutionPlan(spec,currentWidth,currentHeight,context,chooseTargetDimensions),
};
