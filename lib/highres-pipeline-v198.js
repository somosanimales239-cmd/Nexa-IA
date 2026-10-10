'use strict';

const fs = require('fs');
const path = require('path');

function roundToMultiple(value, step = 64, min = 64) {
  const v = Math.max(min, Number(value) || min);
  return Math.max(min, Math.round(v / step) * step);
}

function chooseHighResolutionPlan(spec, currentWidth, currentHeight, context = {}, chooseTargetDimensions) {
  if (typeof chooseTargetDimensions !== 'function') return null;
  const target = chooseTargetDimensions(spec, currentWidth, currentHeight, context);
  if (!target) return null;

  const cw = Math.max(1, Number(currentWidth) || 1024);
  const ch = Math.max(1, Number(currentHeight) || 1024);
  const style = String(context?.style || 'auto');
  const ratio = target.width / Math.max(1, target.height);

  const stageLimit = spec.wants4k
    ? (style === 'photorealistic' ? 1600 : style === 'anime' || style === 'cartoon' ? 1792 : 1664)
    : spec.wants2k
      ? 1536
      : spec.wants1080
        ? 1280
        : 0;
  if (!stageLimit) return null;

  let stage1Width, stage1Height;
  if (target.width >= target.height) {
    stage1Width = Math.min(stageLimit, target.width);
    stage1Height = Math.round(stage1Width / ratio);
  } else {
    stage1Height = Math.min(stageLimit, target.height);
    stage1Width = Math.round(stage1Height * ratio);
  }

  stage1Width = roundToMultiple(stage1Width, 64, 512);
  stage1Height = roundToMultiple(stage1Height, 64, 512);

  if (Math.abs(stage1Width - cw) < 64 && Math.abs(stage1Height - ch) < 64) {
    const growth = spec.wants4k ? 1.35 : 1.25;
    stage1Width = roundToMultiple(Math.min(stageLimit, cw * growth), 64, 512);
    stage1Height = roundToMultiple(Math.min(stageLimit, ch * growth), 64, 512);
  }

  const denoise = style === 'photorealistic' ? 0.20 : style === 'anime' || style === 'cartoon' ? 0.26 : 0.23;
  const cfg = style === 'photorealistic' ? 6.5 : style === 'anime' || style === 'cartoon' ? 6.0 : 6.25;
  const steps = style === 'photorealistic' ? 26 : 24;

  return {
    requested: true,
    mode: 'adaptive-high-resolution-4k-pipeline',
    qualityPriority: 'finish-with-quality',
    target,
    stage1: {
      type: 'latent-refine',
      width: stage1Width,
      height: stage1Height,
      steps,
      cfg,
      denoise,
      sampler: 'dpmpp_2m',
      scheduler: 'karras',
      maxWaitMs: spec.wants4k ? 25 * 60 * 1000 : 15 * 60 * 1000,
      heartbeatMs: 15000,
    },
    stage2: {
      type: 'exact-scale',
      width: target.width,
      height: target.height,
      method: 'lanczos',
      maxWaitMs: spec.wants4k ? 15 * 60 * 1000 : 10 * 60 * 1000,
      heartbeatMs: 15000,
    },
  };
}

async function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitForComfyImage(baseUrl, promptId, requestJson, requestBuffer, collectImages, options = {}) {
  const cleanBase = String(baseUrl || 'http://127.0.0.1:8188').replace(/\/$/, '');
  const started = Date.now();
  const stageLabel = String(options.stageLabel || 'ComfyUI stage');
  const maxWaitMs = Math.max(60000, Number(options.maxWaitMs) || (15 * 60 * 1000));
  const heartbeatMs = Math.max(5000, Number(options.heartbeatMs) || 15000);
  const pollMs = Math.max(900, Number(options.pollMs) || 1500);
  const progress = typeof options.progress === 'function' ? options.progress : null;

  let meta = null;
  let lastBeat = 0;

  while (Date.now() - started < maxWaitMs) {
    try {
      const hist = await requestJson('GET', cleanBase + '/history/' + encodeURIComponent(promptId), null, 30000);
      const entry = hist?.[promptId] || hist;
      const imgs = collectImages(entry);
      if (imgs.length) {
        meta = imgs[0];
        break;
      }
    } catch (_) {}

    const elapsed = Date.now() - started;
    if (progress && elapsed - lastBeat >= heartbeatMs) {
      lastBeat = elapsed;
      progress(`${stageLabel}: ComfyUI sigue trabajando (${Math.round(elapsed / 1000)}s)… esperando resultado final con calidad.`);
    }
    await sleep(pollMs);
  }

  if (!meta) {
    throw new Error(`${stageLabel}: ComfyUI no terminó dentro del tiempo ampliado (${Math.round(maxWaitMs / 1000)}s).`);
  }

  const q = new URLSearchParams({
    filename: String(meta.filename || ''),
    subfolder: String(meta.subfolder || ''),
    type: String(meta.type || 'output'),
  });
  const buffer = await requestBuffer('GET', cleanBase + '/view?' + q.toString(), 300000);
  return { meta, buffer, elapsedMs: Date.now() - started };
}

async function queueComfyWorkflow(baseUrl, workflow, clientId, requestJson, timeoutMs = 45000) {
  const cleanBase = String(baseUrl || 'http://127.0.0.1:8188').replace(/\/$/, '');
  const queued = await requestJson('POST', cleanBase + '/prompt', { prompt: workflow, client_id: clientId }, timeoutMs);
  const promptId = queued?.prompt_id;
  if (!promptId) throw new Error('ComfyUI no devolvió prompt_id.');
  return promptId;
}

async function exactScaleWithComfy(filePath, baseUrl, width, height, requestId, progress, requestJson, requestBuffer, uploadImage, collectImages, stageOptions = {}) {
  const cleanBase = String(baseUrl || 'http://127.0.0.1:8188').replace(/\/$/, '');
  const upload = await uploadImage(cleanBase, filePath, `nexa-v198-${requestId}.png`);
  const inputName = String(upload?.name || upload?.filename || `nexa-v198-${requestId}.png`);
  const workflow = {
    '1': { class_type: 'LoadImage', inputs: { image: inputName } },
    '2': { class_type: 'ImageScale', inputs: { image: ['1', 0], upscale_method: 'lanczos', width: Number(width), height: Number(height), crop: 'disabled' } },
    '3': { class_type: 'SaveImage', inputs: { filename_prefix: 'NexaAI-v198-upscale', images: ['2', 0] } },
  };
  progress?.(`High-Resolution 4K Pipeline: etapa exact-scale ${width}×${height}…`);
  const promptId = await queueComfyWorkflow(cleanBase, workflow, `nexa-v198-scale-${requestId}`, requestJson);
  const out = await waitForComfyImage(cleanBase, promptId, requestJson, requestBuffer, collectImages, {
    stageLabel: `exact-scale ${width}×${height}`,
    progress,
    maxWaitMs: stageOptions.maxWaitMs || (15 * 60 * 1000),
    heartbeatMs: stageOptions.heartbeatMs || 15000,
  });
  const dest = path.join(path.dirname(filePath), path.basename(filePath, path.extname(filePath)) + '-scaled.png');
  fs.writeFileSync(dest, out.buffer);
  return dest;
}

async function latentRefineWithComfy(filePath, baseUrl, prepared, stage, requestId, progress, requestJson, requestBuffer, uploadImage, collectImages, clean) {
  const cleanBase = String(baseUrl || 'http://127.0.0.1:8188').replace(/\/$/, '');
  const checkpoint = prepared?.runtime?.resolvedCheckpoint || '';
  if (!checkpoint) throw new Error('No hay checkpoint resuelto para refine.');
  const upload = await uploadImage(cleanBase, filePath, `nexa-v198-refine-${requestId}.png`);
  const inputName = String(upload?.name || upload?.filename || `nexa-v198-refine-${requestId}.png`);
  const positiveText = clean(prepared?.generationRequest || prepared?.positive || '', 12000);
  const negativeText = clean(prepared?.negative || '', 8000);
  const workflow = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    '2': { class_type: 'LoadImage', inputs: { image: inputName } },
    '3': { class_type: 'VAEEncode', inputs: { pixels: ['2', 0], vae: ['1', 2] } },
    '4': { class_type: 'LatentUpscale', inputs: { samples: ['3', 0], upscale_method: 'bicubic', width: Number(stage.width), height: Number(stage.height), crop: 'disabled' } },
    '5': { class_type: 'CLIPTextEncode', inputs: { text: positiveText, clip: ['1', 1] } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: negativeText, clip: ['1', 1] } },
    '7': { class_type: 'KSampler', inputs: { model: ['1', 0], seed: Math.floor(Math.random() * 4294967295), steps: Number(stage.steps || 24), cfg: Number(stage.cfg || 6.5), sampler_name: String(stage.sampler || 'dpmpp_2m'), scheduler: String(stage.scheduler || 'karras'), positive: ['5', 0], negative: ['6', 0], latent_image: ['4', 0], denoise: Number(stage.denoise || 0.23) } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['1', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'NexaAI-v198-refine', images: ['8', 0] } },
  };
  progress?.(`High-Resolution 4K Pipeline: etapa refine ${stage.width}×${stage.height} con ${checkpoint}…`);
  const promptId = await queueComfyWorkflow(cleanBase, workflow, `nexa-v198-refine-${requestId}`, requestJson);
  const out = await waitForComfyImage(cleanBase, promptId, requestJson, requestBuffer, collectImages, {
    stageLabel: `latent-refine ${stage.width}×${stage.height}`,
    progress,
    maxWaitMs: stage.maxWaitMs || (25 * 60 * 1000),
    heartbeatMs: stage.heartbeatMs || 15000,
  });
  const dest = path.join(path.dirname(filePath), path.basename(filePath, path.extname(filePath)) + '-refined.png');
  fs.writeFileSync(dest, out.buffer);
  return dest;
}

async function runHighResolutionPipeline(options = {}) {
  const { filePath, baseUrl, prepared, requestId, progress, readImageSize, requestJson, requestBuffer, uploadImage, collectImages, clean, chooseTargetDimensions } = options;
  const currentSize = readImageSize(filePath, {});
  const plan = prepared?.highResolutionPlan || chooseHighResolutionPlan(prepared?.technical || {}, currentSize.width, currentSize.height, prepared || {}, chooseTargetDimensions);
  if (!plan?.requested) return { path: filePath, plan: null, stages: [] };

  const stages = [];
  let current = filePath;
  let refineError = null;

  try {
    current = await latentRefineWithComfy(current, baseUrl, prepared, plan.stage1, requestId, progress, requestJson, requestBuffer, uploadImage, collectImages, clean);
    const size = readImageSize(current, {});
    stages.push({ stage: 'latent-refine', ok: true, width: size.width, height: size.height, target: plan.stage1 });
  } catch (error) {
    refineError = String(error?.message || error);
    stages.push({ stage: 'latent-refine', ok: false, error: refineError, target: plan.stage1 });
    progress?.(`High-Resolution 4K Pipeline: refine no disponible, usando exact-scale (${refineError})`);
  }

  const refinedSize = readImageSize(current, {});
  if (refinedSize.width !== plan.stage2.width || refinedSize.height !== plan.stage2.height) {
    current = await exactScaleWithComfy(current, baseUrl, plan.stage2.width, plan.stage2.height, requestId, progress, requestJson, requestBuffer, uploadImage, collectImages, plan.stage2);
  }
  const finalSize = readImageSize(current, {});
  stages.push({ stage: 'exact-scale', ok: true, width: finalSize.width, height: finalSize.height, target: plan.stage2, method: plan.stage2.method });
  return { path: current, plan, stages, refineError };
}

module.exports = { roundToMultiple, chooseHighResolutionPlan, runHighResolutionPipeline };
