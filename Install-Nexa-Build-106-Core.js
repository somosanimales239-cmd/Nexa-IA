'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const root = process.cwd();
const backupDir = path.join(root, '.nexa-build106-backup');
const filesToBackup = ['main.js', 'preload.js', 'src/app.js', 'src/index.html', 'package.json', 'nexa.project.json'];
const createdFiles = ['lib/visual-evaluator.js', 'scripts/validate-visual-evaluator.js', 'README-Image-Visual-Evaluator-Build-106.txt'];

function die(message) {
  console.error(`\nBUILD 106 ERROR: ${message}\n`);
  process.exit(1);
}
function file(rel) { return path.join(root, rel); }
function read(rel) { return fs.readFileSync(file(rel), 'utf8'); }
function write(rel, content) { fs.mkdirSync(path.dirname(file(rel)), { recursive: true }); fs.writeFileSync(file(rel), content, 'utf8'); }
function replaceOnce(text, from, to, label) {
  const index = text.indexOf(from);
  if (index < 0) die(`No encontré el ancla requerida: ${label}`);
  if (text.indexOf(from, index + from.length) >= 0) die(`El ancla no es única: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}
function replaceRegexOnce(text, re, to, label) {
  const matches = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || [];
  if (matches.length !== 1) die(`Esperaba una coincidencia para ${label}; encontré ${matches.length}.`);
  return text.replace(re, to);
}
function backup() {
  if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive:true, force:true });
  fs.mkdirSync(backupDir, { recursive:true });
  for (const rel of filesToBackup) {
    if (!fs.existsSync(file(rel))) die(`Falta archivo baseline: ${rel}`);
    const target = path.join(backupDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive:true });
    fs.copyFileSync(file(rel), target);
  }
  fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify({
    build:'Nexa AI v1.7.0 Build 106 — Nexa Visual Evaluator v1',
    createdFiles,
    backedUp:filesToBackup,
    createdAt:new Date().toISOString(),
  }, null, 2) + '\n');
}
function rollback() {
  if (!fs.existsSync(backupDir)) return;
  for (const rel of filesToBackup) {
    const source = path.join(backupDir, rel);
    if (fs.existsSync(source)) {
      fs.mkdirSync(path.dirname(file(rel)), { recursive:true });
      fs.copyFileSync(source, file(rel));
    }
  }
  console.error('Se restauró automáticamente el baseline anterior.');
}
function run(command, args) {
  const result = cp.spawnSync(command, args, { cwd:root, stdio:'inherit', shell:false });
  if (result.error || result.status !== 0) throw result.error || new Error(`${command} terminó con código ${result.status}`);
}

for (const rel of ['main.js','preload.js','src/app.js','src/index.html','package.json','nexa.project.json','lib/visual-evaluator.js','scripts/validate-visual-evaluator.js']) {
  if (!fs.existsSync(file(rel))) die(`No encontré ${rel}. Extrae el ZIP Build 106 en la raíz del proyecto Build 105.`);
}

const baselineReadme = file('README-Image-Stage1-Build-105.txt');
if (!fs.existsSync(baselineReadme)) die('Este update requiere Nexa AI v1.7.0 Build 105 como baseline.');
if (read('main.js').includes('NEXA_VISUAL_EVALUATOR_BUILD_106')) {
  console.log('Build 106 ya está instalado. No se realizaron cambios.');
  process.exit(0);
}

backup();

try {
  let main = read('main.js');

  main = replaceOnce(main,
`const { catalogProtocolInstructions, parseFlexibleVehicleCatalog, fallbackCatalogFromEvidence } = require('./lib/vehicle-catalog');`,
`const { catalogProtocolInstructions, parseFlexibleVehicleCatalog, fallbackCatalogFromEvidence } = require('./lib/vehicle-catalog');
const {
  DEFAULT_VISUAL_EVALUATOR_MODEL,
  VISUAL_EVALUATION_SCHEMA,
  buildEvaluationPrompt,
  scoreEvaluation: scoreVisualEvaluation,
  applyRepairs: applyVisualRepairs,
  bestAttempt: bestVisualAttempt,
  evaluationSummary: visualEvaluationSummary,
} = require('./lib/visual-evaluator');
// NEXA_VISUAL_EVALUATOR_BUILD_106`, 'main import');

  main = replaceOnce(main, `const APP_VERSION = '1.7.0';`, `const APP_VERSION = '1.7.0';\nconst APP_BUILD = 106;`, 'app build number');

  main = replaceOnce(main,
`    return safeClone({ ...this.state, dataDirectory: this.dir, knowledgeDirectory: knowledgeStore?.root || null, knowledgeDatabase: knowledgeDb?.path || null, appVersion: APP_VERSION });`,
`    return safeClone({ ...this.state, dataDirectory: this.dir, knowledgeDirectory: knowledgeStore?.root || null, knowledgeDatabase: knowledgeDb?.path || null, appVersion: APP_VERSION, appBuild: APP_BUILD });`, 'snapshot build number');

  main = replaceOnce(main,
`  comfyBaseUrl: 'http://127.0.0.1:8188',
  comfyCheckpoint: '',
});`,
`  comfyBaseUrl: 'http://127.0.0.1:8188',
  comfyCheckpoint: '',
  visualEvaluatorEnabled: true,
  visualEvaluatorModel: DEFAULT_VISUAL_EVALUATOR_MODEL,
  visualEvaluatorThreshold: 86,
  visualEvaluatorMaxAttempts: 3,
  visualEvaluatorCpuOnly: true,
});`, 'main defaults');

  main = replaceOnce(main,
`let ollamaChild = null;
const factoryWorkers = new Map();`,
`let ollamaChild = null;
let visualEvaluatorInstallChild = null;
const factoryWorkers = new Map();`, 'visual install child');

  main = replaceOnce(main,
`      'comfyBaseUrl', 'comfyCheckpoint',
    ];`,
`      'comfyBaseUrl', 'comfyCheckpoint',
      'visualEvaluatorEnabled', 'visualEvaluatorModel', 'visualEvaluatorThreshold', 'visualEvaluatorMaxAttempts', 'visualEvaluatorCpuOnly',
    ];`, 'settings allow-list');

  main = replaceOnce(main,
`    this.state.settings.researchBatchSize = Math.max(1, Math.min(10, Number(this.state.settings.researchBatchSize) || 3));
    this.save();`,
`    this.state.settings.researchBatchSize = Math.max(1, Math.min(10, Number(this.state.settings.researchBatchSize) || 3));
    this.state.settings.visualEvaluatorModel = String(this.state.settings.visualEvaluatorModel || DEFAULT_VISUAL_EVALUATOR_MODEL).trim() || DEFAULT_VISUAL_EVALUATOR_MODEL;
    this.state.settings.visualEvaluatorThreshold = Math.max(50, Math.min(100, Number(this.state.settings.visualEvaluatorThreshold) || 86));
    this.state.settings.visualEvaluatorMaxAttempts = Math.max(1, Math.min(3, Number(this.state.settings.visualEvaluatorMaxAttempts) || 3));
    this.state.settings.visualEvaluatorEnabled = this.state.settings.visualEvaluatorEnabled !== false;
    this.state.settings.visualEvaluatorCpuOnly = this.state.settings.visualEvaluatorCpuOnly !== false;
    this.save();`, 'settings normalization');

  main = replaceOnce(main,
`          positivePrompt: String(m.image.positivePrompt || ''),
          negativePrompt: String(m.image.negativePrompt || ''),
        } : null,`,
`          positivePrompt: String(m.image.positivePrompt || ''),
          negativePrompt: String(m.image.negativePrompt || ''),
          evaluationScore: Number.isFinite(Number(m.image.evaluationScore)) ? Number(m.image.evaluationScore) : null,
          evaluationStatus: String(m.image.evaluationStatus || ''),
          evaluationAttempts: Number(m.image.evaluationAttempts || 0) || null,
          evaluator: String(m.image.evaluator || ''),
          errorsCorrected: Array.isArray(m.image.errorsCorrected) ? m.image.errorsCorrected.map(String).slice(0, 16) : [],
        } : null,`, 'image persistence');

  const releaseAnchor = `async function releaseComfyResources(baseUrl) {
  const cleanBase = String(baseUrl || '').replace(/\\\/$/, '');
  if (!cleanBase) return false;
  try {
    await requestJsonUrl('POST', \`\${cleanBase}/free\`, { unload_models: true, free_memory: true }, 5000);
    return true;
  } catch (_) {
    return false;
  }
}`;

  const evaluatorHelpers = `${releaseAnchor}

function visualEvaluatorModelName() {
  return String(store.state.settings.visualEvaluatorModel || DEFAULT_VISUAL_EVALUATOR_MODEL).trim() || DEFAULT_VISUAL_EVALUATOR_MODEL;
}

function visualEvaluatorProgress(event, payload) {
  try {
    if (event?.sender && !event.sender.isDestroyed()) event.sender.send('visual-evaluator:progress', payload || {});
  } catch (_) {}
}

async function visualEvaluatorStatus() {
  const settings = store.state.settings;
  const model = visualEvaluatorModelName();
  const status = await ollamaStatus();
  const installed = status.online && Array.isArray(status.installed) && status.installed.some(name => String(name || '').split('@')[0] === model);
  return {
    enabled: settings.visualEvaluatorEnabled !== false,
    model,
    online: Boolean(status.online),
    installed: Boolean(installed),
    ready: Boolean(status.online && installed && settings.visualEvaluatorEnabled !== false),
    cpuOnly: settings.visualEvaluatorCpuOnly !== false,
    threshold: Math.max(50, Math.min(100, Number(settings.visualEvaluatorThreshold) || 86)),
    maxAttempts: Math.max(1, Math.min(3, Number(settings.visualEvaluatorMaxAttempts) || 3)),
    installing: Boolean(visualEvaluatorInstallChild),
    error: status.error || '',
  };
}

async function installVisualEvaluator(event) {
  const settings = store.state.settings;
  const model = visualEvaluatorModelName();
  if (visualEvaluatorInstallChild) return { ok:false, error:'La instalación del evaluador ya está en curso.' };
  if (!fs.existsSync(settings.ollamaExe)) return { ok:false, error:\`No se encontró Ollama en \${settings.ollamaExe}\` };
  let status = await ollamaStatus();
  if (!status.online) {
    const started = await startOllama();
    if (!started.ok) return started;
    status = await ollamaStatus();
  }
  if (Array.isArray(status.installed) && status.installed.some(name => String(name || '').split('@')[0] === model)) {
    return { ok:true, alreadyInstalled:true, status:await visualEvaluatorStatus() };
  }
  visualEvaluatorProgress(event, { state:'downloading', message:\`Descargando \${model} con Ollama…\` });
  return new Promise(resolve => {
    try {
      const child = spawn(settings.ollamaExe, ['pull', model], {
        windowsHide:true,
        detached:false,
        env:{ ...process.env, OLLAMA_MODELS:settings.modelsPath },
        stdio:['ignore','pipe','pipe'],
      });
      visualEvaluatorInstallChild = child;
      let tail = '';
      const report = chunk => {
        tail = (tail + String(chunk || '')).slice(-1200);
        const parts = tail.split('\\r').join('\\n').split('\\n').map(value => value.trim()).filter(Boolean);
        const last = parts[parts.length - 1] || \`Descargando \${model}…\`;
        visualEvaluatorProgress(event, { state:'downloading', message:last.slice(0, 180) });
      };
      child.stdout.on('data', report);
      child.stderr.on('data', report);
      child.on('error', error => {
        visualEvaluatorInstallChild = null;
        visualEvaluatorProgress(event, { state:'error', message:error.message });
        resolve({ ok:false, error:error.message });
      });
      child.on('exit', async code => {
        visualEvaluatorInstallChild = null;
        if (code !== 0) {
          const error = \`Ollama pull terminó con código \${code}.\`;
          visualEvaluatorProgress(event, { state:'error', message:error });
          return resolve({ ok:false, error });
        }
        const finalStatus = await visualEvaluatorStatus();
        visualEvaluatorProgress(event, { state:'ready', message:\`\${model} instalado y listo.\` });
        resolve({ ok:true, status:finalStatus });
      });
    } catch (error) {
      visualEvaluatorInstallChild = null;
      resolve({ ok:false, error:error.message });
    }
  });
}

function unloadVisualEvaluatorModel() {
  const settings = store.state.settings;
  const model = visualEvaluatorModelName();
  return new Promise(resolve => {
    if (!fs.existsSync(settings.ollamaExe)) return resolve(false);
    execFile(settings.ollamaExe, ['stop', model], {
      windowsHide:true,
      timeout:10000,
      env:{ ...process.env, OLLAMA_MODELS:settings.modelsPath },
    }, () => resolve(true));
  });
}

async function evaluateGeneratedImage(saved, userRequest, plan, attempt, job) {
  const settings = store.state.settings;
  if (settings.visualEvaluatorEnabled === false) return { available:false, reason:'disabled' };
  const status = await visualEvaluatorStatus();
  if (!status.online) return { available:false, reason:'ollama_offline' };
  if (!status.installed) return { available:false, reason:'model_not_installed' };
  ensureImageJobActive(job);
  if (!saved?.path || !fs.existsSync(saved.path)) return { available:false, reason:'image_missing' };

  const options = { temperature:0, num_ctx:4096, num_predict:650 };
  if (settings.visualEvaluatorCpuOnly !== false) options.num_gpu = 0;
  const imageBase64 = fs.readFileSync(saved.path).toString('base64');
  const prompt = buildEvaluationPrompt({ userRequest, plan, attempt });
  try {
    const response = await requestJsonTracked('POST', \`\${settings.baseUrl}/api/chat\`, {
      model:status.model,
      stream:false,
      keep_alive:'0s',
      format:VISUAL_EVALUATION_SCHEMA,
      options,
      messages:[
        { role:'system', content:'You are Nexa Visual Evaluator v1. Return only the structured evaluation requested by the schema.' },
        { role:'user', content:prompt, images:[imageBase64] },
      ],
    }, 150000, job, 'evaluatorRequest');
    ensureImageJobActive(job);
    const content = response?.message?.content || '';
    const parsed = JSON.parse(extractFirstJsonObject(content));
    const evaluation = scoreVisualEvaluation(parsed, status.threshold);
    return { available:true, model:status.model, evaluation };
  } catch (error) {
    if (job?.cancelled) throw new Error('Generación detenida por el usuario.');
    return { available:false, reason:'evaluation_error', error:error.message };
  } finally {
    unloadVisualEvaluatorModel().catch(() => null);
  }
}`;

  main = replaceOnce(main, releaseAnchor, evaluatorHelpers, 'visual evaluator helpers');

  const newGenerate = `async function generateImage(event, payload) {
  const requestId = String(payload?.requestId || id('img'));
  const userRequest = String(payload?.userRequest || '').trim();
  if (!userRequest) throw new Error('La solicitud de imagen está vacía.');
  const settings = store.state.settings;
  const baseUrl = String(settings.comfyBaseUrl || 'http://127.0.0.1:8188').trim() || 'http://127.0.0.1:8188';
  const job = { requestId, baseUrl, promptId:null, cancelled:false, plannerRequest:null, evaluatorRequest:null };
  activeImageRequests.set(requestId, job);
  try {
    imageProgress(event, requestId, 'planning', 'Preparando el prompt de la imagen…');
    const draftPlan = await buildImagePlanWithOllama(userRequest, job);
    ensureImageJobActive(job);

    imageProgress(event, requestId, 'connecting', 'Conectando con ComfyUI…');
    const checkpoint = await resolveComfyCheckpoint(baseUrl);
    ensureImageJobActive(job);
    const comfyOptions = await getComfyKSamplerOptions(baseUrl);
    ensureImageJobActive(job);
    let currentPlan = normalizeComfyPlan(draftPlan, comfyOptions);

    const evaluatorEnabled = settings.visualEvaluatorEnabled !== false;
    const maxAttempts = evaluatorEnabled ? Math.max(1, Math.min(3, Number(settings.visualEvaluatorMaxAttempts) || 3)) : 1;
    const attempts = [];
    let fallbackImage = null;
    let evaluatorUnavailable = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      ensureImageJobActive(job);
      const workflow = buildComfyWorkflow(currentPlan, checkpoint);
      imageProgress(event, requestId, 'queueing', \`Enviando intento \${attempt}/\${maxAttempts} a ComfyUI…\`, { attempt, maxAttempts, width:currentPlan.width, height:currentPlan.height, steps:currentPlan.steps });
      const promptId = await queueComfyPrompt(baseUrl, workflow, \`nexa-\${requestId}-a\${attempt}\`);
      job.promptId = promptId;
      ensureImageJobActive(job);

      imageProgress(event, requestId, 'rendering', \`Renderizando intento \${attempt}/\${maxAttempts} · \${currentPlan.width}×\${currentPlan.height} · \${currentPlan.steps} pasos…\`, { attempt, maxAttempts, width:currentPlan.width, height:currentPlan.height, steps:currentPlan.steps });
      const images = await waitForComfyResult(baseUrl, promptId, requestId);
      ensureImageJobActive(job);

      imageProgress(event, requestId, 'saving', \`Guardando intento \${attempt}/\${maxAttempts}…\`);
      const saved = await copyComfyImageToNexa(baseUrl, images[0], \`\${requestId}-a\${attempt}\`, currentPlan);
      fallbackImage = saved;
      ensureImageJobActive(job);

      imageProgress(event, requestId, 'evaluating', \`Nexa Visual está revisando intento \${attempt}/\${maxAttempts}…\`, { attempt, maxAttempts });
      const inspected = await evaluateGeneratedImage(saved, userRequest, currentPlan, attempt, job);
      ensureImageJobActive(job);

      if (!inspected.available) {
        evaluatorUnavailable = true;
        attempts.push({ attempt, image:saved, plan:currentPlan, evaluation:null, evaluatorReason:inspected.reason || 'unavailable' });
        break;
      }

      const evaluation = inspected.evaluation;
      attempts.push({ attempt, image:saved, plan:currentPlan, evaluation, evaluator:inspected.model });
      if (evaluation.pass) {
        imageProgress(event, requestId, 'approved', \`Nexa Visual aprobó la imagen · \${evaluation.score}/100.\`, { attempt, maxAttempts, score:evaluation.score });
        break;
      }
      if (attempt < maxAttempts) {
        const issue = evaluation.error_codes.length ? evaluation.error_codes.join(', ') : 'calidad visual';
        imageProgress(event, requestId, 'repairing', \`Corrigiendo \${issue} · siguiente intento \${attempt + 1}/\${maxAttempts}…\`, { attempt, maxAttempts, score:evaluation.score, errors:evaluation.error_codes });
        currentPlan = normalizeComfyPlan(applyVisualRepairs(currentPlan, evaluation, attempt + 1), comfyOptions);
      }
    }

    ensureImageJobActive(job);
    const best = bestVisualAttempt(attempts);
    const chosen = best || attempts[0] || (fallbackImage ? { attempt:1, image:fallbackImage, plan:currentPlan, evaluation:null } : null);
    if (!chosen?.image?.path) throw new Error('ComfyUI no produjo una imagen utilizable.');

    const allErrors = [...new Set(attempts.flatMap(item => item?.evaluation?.error_codes || []))];
    const saved = {
      ...chosen.image,
      evaluationScore: Number.isFinite(Number(chosen.evaluation?.score)) ? Number(chosen.evaluation.score) : null,
      evaluationStatus: chosen.evaluation ? (chosen.evaluation.pass ? 'PASS' : 'BEST_AVAILABLE') : (evaluatorUnavailable ? 'SKIPPED' : ''),
      evaluationAttempts: attempts.length || 1,
      evaluator: chosen.evaluator || (chosen.evaluation ? visualEvaluatorModelName() : ''),
      errorsCorrected: allErrors,
    };

    for (const item of attempts) {
      const candidate = item?.image?.path;
      if (candidate && candidate !== saved.path && fs.existsSync(candidate)) {
        try { fs.unlinkSync(candidate); } catch (_) {}
      }
    }

    const visualSummary = chosen.evaluation
      ? visualEvaluationSummary(chosen.evaluation, attempts.length)
      : 'Nexa Visual no estaba disponible; se conservó el resultado de ComfyUI.';
    imageProgress(event, requestId, 'done', chosen.evaluation ? \`Imagen terminada · Nexa Visual \${chosen.evaluation.score}/100.\` : 'Imagen terminada.', { width:saved.width, height:saved.height, score:saved.evaluationScore });
    releaseComfyResources(baseUrl).catch(() => null);
    return {
      ok:true,
      requestId,
      image:saved,
      plan:chosen.plan || currentPlan,
      evaluation:chosen.evaluation || null,
      attempts:attempts.map(item => ({ attempt:item.attempt, score:item.evaluation?.score ?? null, pass:Boolean(item.evaluation?.pass), errors:item.evaluation?.error_codes || [] })),
      summary:\`Imagen generada (\${saved.width}×\${saved.height}, estilo \${saved.style}). \${visualSummary}\`,
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
    releaseComfyResources(baseUrl).catch(() => null);
    activeImageRequests.delete(requestId);
  }
}

async function stopImageGeneration`;

  main = replaceRegexOnce(main, /async function generateImage\(event, payload\) \{[\s\S]*?\n\}\n\nasync function stopImageGeneration/, newGenerate, 'generateImage Build 106');

  main = replaceOnce(main,
`  if (job.plannerRequest) {
    try { job.plannerRequest.destroy(new Error('Generación detenida por el usuario.')); } catch (_) {}
    job.plannerRequest = null;
  }
  const cleanBase = job.baseUrl.replace(/\\\/$/, '');`,
`  if (job.plannerRequest) {
    try { job.plannerRequest.destroy(new Error('Generación detenida por el usuario.')); } catch (_) {}
    job.plannerRequest = null;
  }
  if (job.evaluatorRequest) {
    try { job.evaluatorRequest.destroy(new Error('Generación detenida por el usuario.')); } catch (_) {}
    job.evaluatorRequest = null;
  }
  unloadVisualEvaluatorModel().catch(() => null);
  const cleanBase = job.baseUrl.replace(/\\\/$/, '');`, 'stop evaluator request');

  main = replaceOnce(main,
`  ipcMain.handle('image:save-as', (_event, filePath) => saveImageAs(filePath));

  ipcMain.handle('knowledge:list', () => knowledgeStore.summary());`,
`  ipcMain.handle('image:save-as', (_event, filePath) => saveImageAs(filePath));
  ipcMain.handle('visual-evaluator:status', () => visualEvaluatorStatus());
  ipcMain.handle('visual-evaluator:install', event => installVisualEvaluator(event));

  ipcMain.handle('knowledge:list', () => knowledgeStore.summary());`, 'visual evaluator IPC');

  write('main.js', main);

  let preload = read('preload.js');
  preload = replaceOnce(preload,
`  images: Object.freeze({
    generate: payload => ipcRenderer.invoke('image:generate', payload),
    stop: requestId => ipcRenderer.invoke('image:stop', requestId),
    saveAs: filePath => ipcRenderer.invoke('image:save-as', filePath),
    onProgress: callback => on('image:progress', callback),
  }),
  knowledge: Object.freeze({`,
`  images: Object.freeze({
    generate: payload => ipcRenderer.invoke('image:generate', payload),
    stop: requestId => ipcRenderer.invoke('image:stop', requestId),
    saveAs: filePath => ipcRenderer.invoke('image:save-as', filePath),
    onProgress: callback => on('image:progress', callback),
  }),
  visualEvaluator: Object.freeze({
    status: () => ipcRenderer.invoke('visual-evaluator:status'),
    install: () => ipcRenderer.invoke('visual-evaluator:install'),
    onProgress: callback => on('visual-evaluator:progress', callback),
  }),
  knowledge: Object.freeze({`, 'preload visual API');
  write('preload.js', preload);

  let html = read('src/index.html');
  html = replaceOnce(html,
`          <label>ComfyUI API<input id="settingComfyBaseUrl" placeholder="http://127.0.0.1:8188" /></label>
          <label>Checkpoint ComfyUI<input id="settingComfyCheckpoint" placeholder="sd_xl_base_1.0.safetensors" /></label>
          <label class="toggle-row"><input id="settingAutoUnity" type="checkbox" /><span>Cambiar automáticamente a Ligero al detectar Unity</span></label>`,
`          <label>ComfyUI API<input id="settingComfyBaseUrl" placeholder="http://127.0.0.1:8188" /></label>
          <label>Checkpoint ComfyUI<input id="settingComfyCheckpoint" placeholder="sd_xl_base_1.0.safetensors" /></label>
          <div class="settings-note image-settings-note"><strong>Nexa Visual Evaluator v1</strong><p>Qwen2.5-VL 3B revisa cada imagen localmente, devuelve JSON estructurado y permite a Nexa reparar y regenerar hasta 3 intentos. Safe CPU evita competir por la VRAM de ComfyUI.</p></div>
          <label class="toggle-row"><input id="settingVisualEvaluatorEnabled" type="checkbox" /><span>Evaluar imágenes automáticamente</span></label>
          <label>Modelo visual<input id="settingVisualEvaluatorModel" placeholder="qwen2.5vl:3b" readonly /></label>
          <div class="settings-grid">
            <label>Quality Threshold<input id="settingVisualEvaluatorThreshold" type="number" min="50" max="100" /></label>
            <label>Maximum Attempts<input id="settingVisualEvaluatorMaxAttempts" type="number" min="1" max="3" /></label>
          </div>
          <label class="toggle-row"><input id="settingVisualEvaluatorCpuOnly" type="checkbox" /><span>Safe CPU · no usar GPU para el evaluador</span></label>
          <div class="bridge-actions"><button id="installVisualEvaluatorBtn" class="secondary small" type="button">Instalar Qwen2.5-VL 3B · ~3.2 GB</button><span id="visualEvaluatorStatus" class="badge muted">Checking</span></div>
          <div id="visualEvaluatorMessage" class="bridge-error" hidden></div>
          <label class="toggle-row"><input id="settingAutoUnity" type="checkbox" /><span>Cambiar automáticamente a Ligero al detectar Unity</span></label>`, 'settings visual evaluator UI');
  write('src/index.html', html);

  let appJs = read('src/app.js');
  appJs = replaceOnce(appJs, `  bridgeStatus: null,\n  factoryCurricula: [],`, `  bridgeStatus: null,\n  visualEvaluatorStatus: null,\n  factoryCurricula: [],`, 'renderer state');

  appJs = replaceOnce(appJs,
`      if (image.width && image.height) meta.push(escapeHtml(String(image.width) + '×' + String(image.height)));
      const metaHtml = meta.length ? '<small>' + meta.join(' · ') + '</small>' : '';`,
`      if (image.width && image.height) meta.push(escapeHtml(String(image.width) + '×' + String(image.height)));
      if (Number.isFinite(Number(image.evaluationScore))) meta.push('Nexa Visual ' + escapeHtml(String(image.evaluationScore)) + '/100');
      if (image.evaluationAttempts) meta.push(escapeHtml(String(image.evaluationAttempts)) + ' intento' + (Number(image.evaluationAttempts) === 1 ? '' : 's'));
      const metaHtml = meta.length ? '<small>' + meta.join(' · ') + '</small>' : '';`, 'image visual metadata');

  appJs = replaceRegexOnce(appJs, /function invokeImageWithTimeout\(requestId, payload, timeoutMs = 360000\) \{[\s\S]*?\n\}/,
`function invokeImageWithTimeout(requestId, payload, timeoutMs = null) {
  const attempts = state.settings.visualEvaluatorEnabled === false ? 1 : Math.max(1, Math.min(3, Number(state.settings.visualEvaluatorMaxAttempts) || 3));
  const resolvedTimeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : 360000 + (Math.max(0, attempts - 1) * 180000);
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (window.nexa.images?.stop) window.nexa.images.stop(requestId).catch(() => {});
      reject(new Error('La generación de imagen superó ' + Math.round(resolvedTimeout / 60000) + ' minutos y fue detenida para evitar que Nexa quede bloqueado.'));
    }, resolvedTimeout);
    window.nexa.images.generate(payload).then(result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }).catch(error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}`, 'dynamic image watchdog');

  appJs = replaceOnce(appJs,
`  els.settingComfyBaseUrl.value = state.settings.comfyBaseUrl || 'http://127.0.0.1:8188';
  els.settingComfyCheckpoint.value = state.settings.comfyCheckpoint || '';
  els.settingAutoUnity.checked = Boolean(state.settings.autoUnityMode);`,
`  els.settingComfyBaseUrl.value = state.settings.comfyBaseUrl || 'http://127.0.0.1:8188';
  els.settingComfyCheckpoint.value = state.settings.comfyCheckpoint || '';
  els.settingVisualEvaluatorEnabled.checked = state.settings.visualEvaluatorEnabled !== false;
  els.settingVisualEvaluatorModel.value = state.settings.visualEvaluatorModel || 'qwen2.5vl:3b';
  els.settingVisualEvaluatorThreshold.value = state.settings.visualEvaluatorThreshold || 86;
  els.settingVisualEvaluatorMaxAttempts.value = state.settings.visualEvaluatorMaxAttempts || 3;
  els.settingVisualEvaluatorCpuOnly.checked = state.settings.visualEvaluatorCpuOnly !== false;
  els.settingAutoUnity.checked = Boolean(state.settings.autoUnityMode);`, 'fill visual settings');

  appJs = replaceOnce(appJs, `async function refreshBridgeStatus() {`,
`async function refreshVisualEvaluatorStatus() {
  if (!window.nexa.visualEvaluator || !els.visualEvaluatorStatus) return;
  try {
    const status = await window.nexa.visualEvaluator.status();
    state.visualEvaluatorStatus = status || null;
    let label = 'OFF';
    let cls = 'muted';
    if (!status?.online) { label = 'OLLAMA OFF'; cls = 'red'; }
    else if (!status?.installed) { label = 'NOT INSTALLED'; cls = 'muted'; }
    else if (status?.enabled) { label = 'READY'; cls = 'lime'; }
    else { label = 'INSTALLED'; cls = 'blue'; }
    els.visualEvaluatorStatus.textContent = label;
    els.visualEvaluatorStatus.className = 'badge ' + cls;
    els.installVisualEvaluatorBtn.disabled = Boolean(status?.installing || status?.installed);
    els.installVisualEvaluatorBtn.textContent = status?.installed ? 'Qwen2.5-VL 3B instalado' : (status?.installing ? 'Instalando Qwen2.5-VL…' : 'Instalar Qwen2.5-VL 3B · ~3.2 GB');
    els.visualEvaluatorMessage.hidden = true;
  } catch (error) {
    els.visualEvaluatorStatus.textContent = 'ERROR';
    els.visualEvaluatorStatus.className = 'badge red';
    els.visualEvaluatorMessage.hidden = false;
    els.visualEvaluatorMessage.textContent = error.message || String(error);
  }
}

async function installVisualEvaluator() {
  if (!window.nexa.visualEvaluator) return;
  els.installVisualEvaluatorBtn.disabled = true;
  els.visualEvaluatorMessage.hidden = false;
  els.visualEvaluatorMessage.textContent = 'Descargando qwen2.5vl:3b con Ollama…';
  const result = await window.nexa.visualEvaluator.install();
  if (result?.ok) toast(result.alreadyInstalled ? 'Qwen2.5-VL 3B ya estaba instalado.' : 'Qwen2.5-VL 3B instalado y listo.','success');
  else toast(result?.error || 'No se pudo instalar Qwen2.5-VL 3B.','error');
  await refreshVisualEvaluatorStatus();
}

async function refreshBridgeStatus() {`, 'visual evaluator renderer functions');

  appJs = replaceOnce(appJs,
`    comfyBaseUrl: els.settingComfyBaseUrl.value.trim() || 'http://127.0.0.1:8188',
    comfyCheckpoint: els.settingComfyCheckpoint.value.trim(),
    autoUnityMode: els.settingAutoUnity.checked,`,
`    comfyBaseUrl: els.settingComfyBaseUrl.value.trim() || 'http://127.0.0.1:8188',
    comfyCheckpoint: els.settingComfyCheckpoint.value.trim(),
    visualEvaluatorEnabled: els.settingVisualEvaluatorEnabled.checked,
    visualEvaluatorModel: els.settingVisualEvaluatorModel.value.trim() || 'qwen2.5vl:3b',
    visualEvaluatorThreshold: Number(els.settingVisualEvaluatorThreshold.value) || 86,
    visualEvaluatorMaxAttempts: Number(els.settingVisualEvaluatorMaxAttempts.value) || 3,
    visualEvaluatorCpuOnly: els.settingVisualEvaluatorCpuOnly.checked,
    autoUnityMode: els.settingAutoUnity.checked,`, 'save visual settings');

  appJs = replaceOnce(appJs,
`  updateModeUi(); fillSettings(); toast('Ajustes guardados.','success'); refreshStats();`,
`  updateModeUi(); fillSettings(); toast('Ajustes guardados.','success'); refreshStats(); refreshVisualEvaluatorStatus();`, 'refresh visual status after save');

  appJs = replaceOnce(appJs,
`    'settingsForm','settingModel','settingBaseUrl','settingOllamaExe','settingModelsPath','settingContext','settingLightLayers','settingKeepAlive','settingComfyBaseUrl','settingComfyCheckpoint','settingAutoUnity',`,
`    'settingsForm','settingModel','settingBaseUrl','settingOllamaExe','settingModelsPath','settingContext','settingLightLayers','settingKeepAlive','settingComfyBaseUrl','settingComfyCheckpoint','settingVisualEvaluatorEnabled','settingVisualEvaluatorModel','settingVisualEvaluatorThreshold','settingVisualEvaluatorMaxAttempts','settingVisualEvaluatorCpuOnly','installVisualEvaluatorBtn','visualEvaluatorStatus','visualEvaluatorMessage','settingAutoUnity',`, 'cache visual elements');

  appJs = replaceOnce(appJs,
`  els.settingsForm.addEventListener('submit', saveSettings);
  els.openDataBtn.addEventListener('click', () => window.nexa.system.openDataFolder());`,
`  els.settingsForm.addEventListener('submit', saveSettings);
  els.installVisualEvaluatorBtn.addEventListener('click', installVisualEvaluator);
  els.openDataBtn.addEventListener('click', () => window.nexa.system.openDataFolder());`, 'bind install visual button');

  appJs = replaceOnce(appJs,
`  window.nexa.chat.onToken(packet => { if (packet.requestId === state.activeRequestId) updateStreamingMessage(packet.content || ''); });`,
`  if (window.nexa.visualEvaluator?.onProgress) window.nexa.visualEvaluator.onProgress(packet => {
    if (!packet) return;
    els.visualEvaluatorMessage.hidden = false;
    els.visualEvaluatorMessage.textContent = packet.message || '';
    if (packet.state === 'ready') refreshVisualEvaluatorStatus();
  });
  window.nexa.chat.onToken(packet => { if (packet.requestId === state.activeRequestId) updateStreamingMessage(packet.content || ''); });`, 'visual install progress listener');

  appJs = replaceOnce(appJs,
`  await Promise.all([refreshStats(), refreshBridgeStatus()]);`,
`  await Promise.all([refreshStats(), refreshBridgeStatus(), refreshVisualEvaluatorStatus()]);`, 'init visual evaluator status');
  const versionAnchor = "  els.versionLabel.textContent = `v${snapshot.appVersion || '1.7.0'}`; if (els.brandVersion) els.brandVersion.textContent = `v${snapshot.appVersion || '1.7.0'}`;";
  appJs = replaceOnce(appJs, versionAnchor,
`  const versionText = 'v' + (snapshot.appVersion || '1.7.0') + (snapshot.appBuild ? ' · Build ' + snapshot.appBuild : ''); els.versionLabel.textContent = versionText; if (els.brandVersion) els.brandVersion.textContent = versionText;`, 'renderer build label');
  write('src/app.js', appJs);

  const pkg = JSON.parse(read('package.json'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['validate:visual-evaluator'] = 'node scripts/validate-visual-evaluator.js';
  if (!String(pkg.scripts.validate || '').includes('validate:visual-evaluator')) {
    pkg.scripts.validate = String(pkg.scripts.validate || 'node --check main.js && node --check preload.js && node --check src/app.js') + ' && npm run validate:visual-evaluator';
  }
  write('package.json', JSON.stringify(pkg, null, 2) + '\n');

  const project = JSON.parse(read('nexa.project.json'));
  project.workspace_revision = '1.0.43';
  project.updated_at = '2026-09-26 08:05:00';
  write('nexa.project.json', JSON.stringify(project, null, 4) + '\n');

  run(process.execPath, ['--check','main.js']);
  run(process.execPath, ['--check','preload.js']);
  run(process.execPath, ['--check','src/app.js']);
  run(process.execPath, ['scripts/validate-visual-evaluator.js']);

  console.log('\n------------------------------------------------------------');
  console.log('Nexa AI v1.7.0 Build 106 — Nexa Visual Evaluator v1');
  console.log('INSTALADO Y VALIDADO');
  console.log('------------------------------------------------------------');
  console.log('Abre Nexa > Ajustes > Nexa Visual Evaluator v1.');
  console.log('Si Qwen no está instalado, usa el botón de instalación.');
  console.log('Backup: .nexa-build106-backup');
} catch (error) {
  console.error(error.stack || error.message || String(error));
  rollback();
  process.exit(1);
}
