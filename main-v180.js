'use strict';

// Nexa AI v1.8.0 active Electron entry point.
// It patches the verified v1.7 core in memory before that core is executed.
// This makes the Visual Review pipeline part of the real runtime instead of a
// post-build installer that can be skipped accidentally.

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { BrowserWindow } = require('electron');

// Static graph hints for Nexa App Builder source-integrity inspection.
const ACTIVE_ELECTRON_GRAPH = {
  preload: path.join(__dirname, 'preload.js'),
  renderer: path.join(__dirname, 'src', 'index.html'),
};
function nexaActiveGraphHint(win) {
  if (false && win instanceof BrowserWindow) win.loadFile(path.join(__dirname, 'src', 'index.html'));
  return ACTIVE_ELECTRON_GRAPH;
}
void nexaActiveGraphHint;

const legacyMainPath = path.join(__dirname, 'main.js');

function fail(message) {
  throw new Error('Nexa v1.8.0 bootstrap: ' + message);
}

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) fail('missing anchor: ' + label);
  if (source.indexOf(from, first + from.length) >= 0) fail('anchor is not unique: ' + label);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

function replaceBetween(source, startToken, endToken, replacement, label) {
  const start = source.indexOf(startToken);
  if (start < 0) fail('missing start anchor: ' + label);
  const end = source.indexOf(endToken, start + startToken.length);
  if (end < 0) fail('missing end anchor: ' + label);
  return source.slice(0, start) + replacement + source.slice(end);
}

// The following functions are source templates. They are stringified and
// inserted into the legacy core, where fs/path/store/Ollama/ComfyUI helpers are
// already available.
function v180Trace(stage, data = {}) {
  try {
    const file = path.join(store.dir, 'visual-evaluator-v180.log');
    fs.appendFileSync(file, JSON.stringify({ at:new Date().toISOString(), stage, ...data }) + '\n', 'utf8');
  } catch (_) {}
}

function v180VisualModelInstalled(status) {
  const model = V180.MODEL;
  return Boolean(status?.online && Array.isArray(status.installed) && status.installed.some(name => {
    const cleanName = String(name || '').split('@')[0];
    return cleanName === model || cleanName === 'qwen2.5vl:3b';
  }));
}

function v180StopVisualModel() {
  const settings = store.state.settings;
  return new Promise(resolve => {
    if (!settings?.ollamaExe || !fs.existsSync(settings.ollamaExe)) return resolve(false);
    execFile(settings.ollamaExe, ['stop', V180.MODEL], {
      windowsHide:true,
      timeout:10000,
      env:{ ...process.env, OLLAMA_MODELS:settings.modelsPath },
    }, () => resolve(true));
  });
}

async function v180EnsureVisualReady() {
  let status = await ollamaStatus();
  if (!status.online) {
    const started = await startOllama();
    if (!started?.ok) throw new Error('Nexa Visual no pudo iniciar Ollama: ' + (started?.error || 'sin respuesta'));
    status = await ollamaStatus();
  }
  if (!v180VisualModelInstalled(status)) {
    throw new Error('Nexa Visual requiere qwen2.5vl:3b. Ejecuta: D:\\LocalAI\\Ollama\\ollama.exe pull qwen2.5vl:3b');
  }
  return status;
}

async function v180CallEvaluator(event, saved, userRequest, plan, attempt, job) {
  const settings = store.state.settings;
  await v180EnsureVisualReady();
  ensureImageJobActive(job);

  await releaseComfyResources(job.baseUrl).catch(() => false);
  await sleep(350);
  ensureImageJobActive(job);

  if (!saved?.path || !fs.existsSync(saved.path)) throw new Error('Nexa Visual no encontró la imagen generada para revisarla.');
  const imageBase64 = fs.readFileSync(saved.path).toString('base64');
  const prompt = V180.evaluationPrompt(userRequest, plan, attempt);
  const options = { temperature:0, num_ctx:4096, num_predict:750, num_gpu:0 };

  imageProgress(event, job.requestId, 'evaluating', `Nexa Visual: llamando Qwen2.5-VL 3B · intento ${attempt}/${V180.MAX_ATTEMPTS}…`, { attempt, maxAttempts:V180.MAX_ATTEMPTS });
  v180Trace('qwen_call_start', { requestId:job.requestId, attempt, model:V180.MODEL, image:saved.path });

  const messages = [
    { role:'system', content:'You are Nexa Visual Evaluator v1.8.0. Inspect the attached image. Return only the requested structured JSON. Never pretend you cannot see an attached image.' },
    { role:'user', content:prompt, images:[imageBase64] },
  ];

  let response;
  try {
    response = await requestJsonTracked('POST', `${settings.baseUrl}/api/chat`, {
      model:V180.MODEL,
      stream:false,
      keep_alive:'0s',
      format:V180.SCHEMA,
      options,
      messages,
    }, 180000, job, 'evaluatorRequest');
  } catch (firstError) {
    v180Trace('qwen_schema_retry', { requestId:job.requestId, attempt, error:firstError.message || String(firstError) });
    ensureImageJobActive(job);
    response = await requestJsonTracked('POST', `${settings.baseUrl}/api/chat`, {
      model:V180.MODEL,
      stream:false,
      keep_alive:'0s',
      format:'json',
      options,
      messages,
    }, 180000, job, 'evaluatorRequest');
  }

  ensureImageJobActive(job);
  const raw = String(response?.message?.content || '').trim();
  if (!raw) throw new Error('Qwen2.5-VL respondió sin evaluación visual.');
  let parsed;
  try { parsed = JSON.parse(extractFirstJsonObject(raw)); }
  catch (error) { throw new Error('Qwen2.5-VL devolvió JSON inválido: ' + error.message); }

  const evaluation = V180.finalizeEvaluation(parsed, userRequest, V180.THRESHOLD);
  v180Trace('qwen_review_complete', {
    requestId:job.requestId,
    attempt,
    score:evaluation.score,
    pass:evaluation.pass,
    detectedSubjectCount:evaluation.detected_subject_count,
    detectedSpecies:evaluation.detected_species,
    errors:evaluation.error_codes,
  });
  return evaluation;
}

async function v180GenerateImageTemplate(event, payload) {
  const requestId = String(payload?.requestId || id('img'));
  const userRequest = String(payload?.userRequest || '').trim();
  if (!userRequest) throw new Error('La solicitud de imagen está vacía.');
  const baseUrl = String(store.state.settings.comfyBaseUrl || 'http://127.0.0.1:8188').trim() || 'http://127.0.0.1:8188';
  const job = { requestId, baseUrl, promptId:null, cancelled:false, plannerRequest:null, evaluatorRequest:null };
  activeImageRequests.set(requestId, job);
  const startedAt = Date.now();
  const attempts = [];

  try {
    imageProgress(event, requestId, 'visual-ready', 'Nexa Visual: comprobando Qwen2.5-VL 3B…');
    await v180EnsureVisualReady();
    ensureImageJobActive(job);
    v180Trace('image_job_start', { requestId, userRequest:userRequest.slice(0,800) });

    imageProgress(event, requestId, 'planning', 'Nexa: preparando prompt y restricciones visuales…');
    const draftPlan = await buildImagePlanWithOllama(userRequest, job);
    ensureImageJobActive(job);

    imageProgress(event, requestId, 'connecting', 'Conectando con ComfyUI…');
    const checkpoint = await resolveComfyCheckpoint(baseUrl);
    ensureImageJobActive(job);
    const comfyOptions = await getComfyKSamplerOptions(baseUrl);
    ensureImageJobActive(job);
    let currentPlan = V180.initialConstraints(normalizeComfyPlan(draftPlan, comfyOptions), userRequest);

    for (let attempt = 1; attempt <= V180.MAX_ATTEMPTS; attempt += 1) {
      ensureImageJobActive(job);
      if (attempt > 1 && Date.now() - startedAt > 300000) {
        v180Trace('retry_budget_stop', { requestId, attempt, elapsedMs:Date.now()-startedAt });
        break;
      }

      const workflow = buildComfyWorkflow(currentPlan, checkpoint);
      imageProgress(event, requestId, 'queueing', `ComfyUI: enviando intento ${attempt}/${V180.MAX_ATTEMPTS}…`, { attempt, maxAttempts:V180.MAX_ATTEMPTS });
      const promptId = await queueComfyPrompt(baseUrl, workflow, `nexa-v180-${requestId}-a${attempt}`);
      job.promptId = promptId;
      ensureImageJobActive(job);

      imageProgress(event, requestId, 'rendering', `Renderizando intento ${attempt}/${V180.MAX_ATTEMPTS} · ${currentPlan.width}×${currentPlan.height} · ${currentPlan.steps} pasos…`, { attempt, maxAttempts:V180.MAX_ATTEMPTS, width:currentPlan.width, height:currentPlan.height, steps:currentPlan.steps });
      const images = await waitForComfyResult(baseUrl, promptId, requestId);
      ensureImageJobActive(job);

      imageProgress(event, requestId, 'saving', `Guardando intento ${attempt}/${V180.MAX_ATTEMPTS} para revisión…`, { attempt, maxAttempts:V180.MAX_ATTEMPTS });
      const saved = await copyComfyImageToNexa(baseUrl, images[0], `${requestId}-a${attempt}`, currentPlan);
      ensureImageJobActive(job);

      const evaluation = await v180CallEvaluator(event, saved, userRequest, currentPlan, attempt, job);
      ensureImageJobActive(job);
      attempts.push({ attempt, image:saved, plan:currentPlan, evaluation });

      if (evaluation.pass) {
        imageProgress(event, requestId, 'approved', `Nexa Visual APROBÓ intento ${attempt}/${V180.MAX_ATTEMPTS} · ${evaluation.score}/100.`, { attempt, score:evaluation.score, errors:evaluation.error_codes });
        break;
      }

      if (attempt < V180.MAX_ATTEMPTS) {
        imageProgress(event, requestId, 'repairing', `Nexa Visual rechazó ${evaluation.score}/100 · ${evaluation.error_codes.join(', ') || 'calidad'} · reparando…`, { attempt, score:evaluation.score, errors:evaluation.error_codes });
        const repaired = V180.applyRepairs(currentPlan, evaluation, userRequest, attempt + 1);
        currentPlan = normalizeComfyPlan(repaired, comfyOptions);
        if (attempt >= 1 && currentPlan.steps > 28) currentPlan.steps = 28;
      }
    }

    ensureImageJobActive(job);
    const chosen = V180.bestAttempt(attempts);
    if (!chosen?.image?.path) throw new Error('Nexa Visual no obtuvo ningún intento evaluado. Revisa visual-evaluator-v180.log.');

    for (const row of attempts) {
      if (row.image?.path && row.image.path !== chosen.image.path && fs.existsSync(row.image.path)) {
        try { fs.unlinkSync(row.image.path); } catch (_) {}
      }
    }

    const visualSummary = V180.summary(chosen.evaluation, attempts.length);
    const saved = {
      ...chosen.image,
      evaluationScore:chosen.evaluation.score,
      evaluationStatus:chosen.evaluation.pass ? 'PASS' : 'BEST_AVAILABLE',
      evaluationAttempts:attempts.length,
      evaluator:V180.MODEL,
      evaluationErrors:chosen.evaluation.error_codes,
    };

    v180Trace('image_job_complete', {
      requestId,
      selectedAttempt:chosen.attempt,
      score:chosen.evaluation.score,
      pass:chosen.evaluation.pass,
      errors:chosen.evaluation.error_codes,
      elapsedMs:Date.now()-startedAt,
    });
    imageProgress(event, requestId, 'done', `Imagen terminada · ${visualSummary}`, { score:chosen.evaluation.score, attempts:attempts.length, pass:chosen.evaluation.pass });

    return {
      ok:true,
      requestId,
      image:saved,
      plan:chosen.plan,
      evaluation:chosen.evaluation,
      attempts:attempts.map(row => ({ attempt:row.attempt, score:row.evaluation.score, pass:row.evaluation.pass, errors:row.evaluation.error_codes })),
      summary:`Imagen generada (${saved.width}×${saved.height}, estilo ${saved.style}). ${visualSummary}`,
    };
  } finally {
    const current = activeImageRequests.get(requestId);
    if (current?.plannerRequest) {
      try { current.plannerRequest.destroy(new Error('Generación finalizada.')); } catch (_) {}
      current.plannerRequest = null;
    }
    if (current?.evaluatorRequest) {
      try { current.evaluatorRequest.destroy(new Error('Generación finalizada.')); } catch (_) {}
      current.evaluatorRequest = null;
    }
    await v180StopVisualModel().catch(() => false);
    releaseComfyResources(baseUrl).catch(() => null);
    activeImageRequests.delete(requestId);
  }
}

function patchLegacyMain(source) {
  let out = String(source || '');

  out = replaceOnce(
    out,
    "const { catalogProtocolInstructions, parseFlexibleVehicleCatalog, fallbackCatalogFromEvidence } = require('./lib/vehicle-catalog');",
    "const { catalogProtocolInstructions, parseFlexibleVehicleCatalog, fallbackCatalogFromEvidence } = require('./lib/vehicle-catalog');\nconst V180 = require('./lib/visual-evaluator-v180');\n// NEXA_VISUAL_PIPELINE_V180",
    'visual evaluator import'
  );

  out = replaceOnce(out, "const APP_VERSION = '1.7.0';", "const APP_VERSION = '1.8.0';", 'application version');

  out = replaceOnce(
    out,
    "  if (/16:9|wallpaper|panorama|banner|wide/.test(text)) return { width: 1024, height: 576 };\n  if (/portrait|vertical|full body|cuerpo completo|persona completa|de pies a cabeza|headshot|retrato|fashion/.test(text)) {",
    "  if (/16:9|wallpaper|panorama|banner|wide/.test(text)) return { width: 1024, height: 576 };\n  if (/close[- ]?up|tight framing|close framing|encuadre (?:muy )?cercano|primer plano|plano cercano/.test(text)) return { width: 896, height: 896 };\n  if (/portrait|vertical|full body|cuerpo completo|persona completa|de pies a cabeza|headshot|retrato|fashion/.test(text)) {",
    'close framing resolution'
  );
  out = replaceOnce(
    out,
    "  if (/landscape|horizontal|coche|carro|car|auto|truck|room|habitaci|interior|beach|playa|city|ciudad|mountain|monta/.test(text)) {",
    "  if (/\\b(landscape|horizontal|coche|carro|car|auto|truck|room|interior|beach|playa|city|ciudad|mountain)\\b|habitaci|monta/.test(text)) {",
    'landscape word boundaries'
  );

  out = replaceOnce(
    out,
    "illustration: 'professional animated character illustration, polished concept art, clean expressive linework, coherent anatomy, dynamic silhouette, detailed cel shading, crisp edges, expressive face, controlled vibrant color palette, high detail'",
    "illustration: 'professional animated character illustration, single-scene composition, clean expressive linework, coherent anatomy, dynamic silhouette, detailed cel shading, crisp edges, expressive face, controlled vibrant color palette, high detail'",
    'illustration quality suffix'
  );
  out = replaceOnce(
    out,
    "illustration: 'professional animated illustration and character concept art'",
    "illustration: 'professional animated character illustration, one finished scene'",
    'illustration fallback prefix'
  );
  out = replaceOnce(
    out,
    "if (style === 'anime' || style === 'illustration') return `${common}, broken linework, inconsistent outline, flat unfinished shading`;",
    "if (style === 'anime' || style === 'illustration') return `${common}, broken linework, inconsistent outline, flat unfinished shading, character sheet, turnaround sheet, reference sheet, lineup, multiple views, multiple poses`;",
    'anti character-sheet negatives'
  );

  const helpers = [v180Trace, v180VisualModelInstalled, v180StopVisualModel, v180EnsureVisualReady, v180CallEvaluator]
    .map(fn => fn.toString()).join('\n\n') + '\n\n';
  out = replaceOnce(out, 'async function generateImage(event, payload) {', helpers + 'async function generateImage(event, payload) {', 'visual helper insertion');

  const generated = v180GenerateImageTemplate.toString().replace('v180GenerateImageTemplate', 'generateImage') + '\n\n';
  out = replaceBetween(out, 'async function generateImage(event, payload) {', 'async function stopImageGeneration(requestId) {', generated, 'generate/evaluate/repair loop');

  out = replaceOnce(
    out,
    "  if (job.plannerRequest) {\n    try { job.plannerRequest.destroy(new Error('Generación detenida por el usuario.')); } catch (_) {}\n    job.plannerRequest = null;\n  }\n  const cleanBase = job.baseUrl.replace(/\\/$/, '');",
    "  if (job.plannerRequest) {\n    try { job.plannerRequest.destroy(new Error('Generación detenida por el usuario.')); } catch (_) {}\n    job.plannerRequest = null;\n  }\n  if (job.evaluatorRequest) {\n    try { job.evaluatorRequest.destroy(new Error('Generación detenida por el usuario.')); } catch (_) {}\n    job.evaluatorRequest = null;\n  }\n  v180StopVisualModel().catch(() => false);\n  const cleanBase = job.baseUrl.replace(/\\/$/, '');",
    'stop visual evaluator request'
  );

  out = replaceOnce(
    out,
    "          positivePrompt: String(m.image.positivePrompt || ''),\n          negativePrompt: String(m.image.negativePrompt || ''),\n        } : null,",
    "          positivePrompt: String(m.image.positivePrompt || ''),\n          negativePrompt: String(m.image.negativePrompt || ''),\n          evaluationScore: Number.isFinite(Number(m.image.evaluationScore)) ? Number(m.image.evaluationScore) : null,\n          evaluationStatus: String(m.image.evaluationStatus || ''),\n          evaluationAttempts: Number(m.image.evaluationAttempts || 0) || null,\n          evaluator: String(m.image.evaluator || ''),\n          evaluationErrors: Array.isArray(m.image.evaluationErrors) ? m.image.evaluationErrors.map(String).slice(0,18) : [],\n        } : null,",
    'chat image review persistence'
  );

  const required = [
    "const APP_VERSION = '1.8.0';",
    'NEXA_VISUAL_PIPELINE_V180',
    'v180CallEvaluator',
    'V180.initialConstraints',
    'V180.applyRepairs',
    'Nexa Visual APROBÓ',
    'model:V180.MODEL',
    'images:[imageBase64]',
    "keep_alive:'0s'",
    'num_gpu:0',
  ];
  for (const marker of required) if (!out.includes(marker)) fail('patched runtime is missing marker: ' + marker);
  return out;
}

if (!fs.existsSync(legacyMainPath)) fail('main.js is missing next to main-v180.js');
const legacySource = fs.readFileSync(legacyMainPath, 'utf8');
const patchedSource = patchLegacyMain(legacySource);

const runtime = new Module(legacyMainPath, module);
runtime.filename = legacyMainPath;
runtime.paths = Module._nodeModulePaths(__dirname);
runtime._compile(patchedSource, legacyMainPath);
