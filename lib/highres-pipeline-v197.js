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
  const stageLimit = spec.wants4k ? 2048 : spec.wants2k ? 1536 : spec.wants1080 ? 1280 : 0;
  if (!stageLimit) return null;
  const ratio = target.width / Math.max(1, target.height);
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
    stage1Width = roundToMultiple(Math.min(stageLimit, cw * 1.5), 64, 512);
    stage1Height = roundToMultiple(Math.min(stageLimit, ch * 1.5), 64, 512);
  }
  const denoise = style === 'photorealistic' ? 0.24 : style === 'anime' || style === 'cartoon' ? 0.28 : 0.26;
  const cfg = style === 'photorealistic' ? 6.5 : 6.0;
  return {
    requested: true,
    mode: 'high-resolution-4k-pipeline',
    target,
    stage1: { type: 'latent-refine', width: stage1Width, height: stage1Height, steps: 24, cfg, denoise, sampler: 'dpmpp_2m', scheduler: 'karras' },
    stage2: { type: 'exact-scale', width: target.width, height: target.height, method: 'lanczos' },
  };
}

async function waitForComfyImage(baseUrl, promptId, requestJson, requestBuffer, collectImages, timeoutMs = 240000) {
  const cleanBase = String(baseUrl || 'http://127.0.0.1:8188').replace(/\/$/, '');
  const started = Date.now();
  let meta = null;
  while (Date.now() - started < timeoutMs) {
    const hist = await requestJson('GET', cleanBase + '/history/' + encodeURIComponent(promptId), null, 30000);
    const entry = hist?.[promptId] || hist;
    const imgs = collectImages(entry);
    if (imgs.length) { meta = imgs[0]; break; }
    await new Promise(r => setTimeout(r, 1200));
  }
  if (!meta) throw new Error('Timeout esperando salida de ComfyUI.');
  const q = new URLSearchParams({ filename:String(meta.filename||''), subfolder:String(meta.subfolder||''), type:String(meta.type||'output') });
  const buffer = await requestBuffer('GET', cleanBase + '/view?' + q.toString(), 120000);
  return { meta, buffer };
}

async function queueComfyWorkflow(baseUrl, workflow, clientId, requestJson, timeoutMs = 20000) {
  const cleanBase = String(baseUrl || 'http://127.0.0.1:8188').replace(/\/$/, '');
  const queued = await requestJson('POST', cleanBase + '/prompt', { prompt:workflow, client_id:clientId }, timeoutMs);
  const promptId = queued?.prompt_id;
  if (!promptId) throw new Error('ComfyUI no devolvió prompt_id.');
  return promptId;
}

async function exactScaleWithComfy(filePath, baseUrl, width, height, requestId, progress, requestJson, requestBuffer, uploadImage, collectImages) {
  const cleanBase = String(baseUrl || 'http://127.0.0.1:8188').replace(/\/$/, '');
  const upload = await uploadImage(cleanBase, filePath, `nexa-v197-${requestId}.png`);
  const inputName = String(upload?.name || upload?.filename || `nexa-v197-${requestId}.png`);
  const workflow = {
    '1': { class_type:'LoadImage', inputs:{ image:inputName } },
    '2': { class_type:'ImageScale', inputs:{ image:['1',0], upscale_method:'lanczos', width:Number(width), height:Number(height), crop:'disabled' } },
    '3': { class_type:'SaveImage', inputs:{ filename_prefix:'NexaAI-v197-upscale', images:['2',0] } },
  };
  progress?.(`High-Resolution 4K Pipeline: etapa exact-scale ${width}×${height}…`);
  const promptId = await queueComfyWorkflow(cleanBase, workflow, `nexa-v197-scale-${requestId}`, requestJson);
  const out = await waitForComfyImage(cleanBase, promptId, requestJson, requestBuffer, collectImages, 240000);
  const dest = path.join(path.dirname(filePath), path.basename(filePath, path.extname(filePath)) + '-scaled.png');
  fs.writeFileSync(dest, out.buffer);
  return dest;
}

async function latentRefineWithComfy(filePath, baseUrl, prepared, stage, requestId, progress, requestJson, requestBuffer, uploadImage, collectImages, clean) {
  const cleanBase = String(baseUrl || 'http://127.0.0.1:8188').replace(/\/$/, '');
  const checkpoint = prepared?.runtime?.resolvedCheckpoint || '';
  if (!checkpoint) throw new Error('No hay checkpoint resuelto para refine.');
  const upload = await uploadImage(cleanBase, filePath, `nexa-v197-refine-${requestId}.png`);
  const inputName = String(upload?.name || upload?.filename || `nexa-v197-refine-${requestId}.png`);
  const positiveText = clean(prepared?.generationRequest || prepared?.positive || '', 12000);
  const negativeText = clean(prepared?.negative || '', 8000);
  const workflow = {
    '1': { class_type:'CheckpointLoaderSimple', inputs:{ ckpt_name: checkpoint } },
    '2': { class_type:'LoadImage', inputs:{ image: inputName } },
    '3': { class_type:'VAEEncode', inputs:{ pixels:['2',0], vae:['1',2] } },
    '4': { class_type:'LatentUpscale', inputs:{ samples:['3',0], upscale_method:'bicubic', width:Number(stage.width), height:Number(stage.height), crop:'disabled' } },
    '5': { class_type:'CLIPTextEncode', inputs:{ text: positiveText, clip:['1',1] } },
    '6': { class_type:'CLIPTextEncode', inputs:{ text: negativeText, clip:['1',1] } },
    '7': { class_type:'KSampler', inputs:{ model:['1',0], seed: Math.floor(Math.random()*4294967295), steps:Number(stage.steps||24), cfg:Number(stage.cfg||6.5), sampler_name:String(stage.sampler||'dpmpp_2m'), scheduler:String(stage.scheduler||'karras'), positive:['5',0], negative:['6',0], latent_image:['4',0], denoise:Number(stage.denoise||0.26) } },
    '8': { class_type:'VAEDecode', inputs:{ samples:['7',0], vae:['1',2] } },
    '9': { class_type:'SaveImage', inputs:{ filename_prefix:'NexaAI-v197-refine', images:['8',0] } },
  };
  progress?.(`High-Resolution 4K Pipeline: etapa refine ${stage.width}×${stage.height} con ${checkpoint}…`);
  const promptId = await queueComfyWorkflow(cleanBase, workflow, `nexa-v197-refine-${requestId}`, requestJson);
  const out = await waitForComfyImage(cleanBase, promptId, requestJson, requestBuffer, collectImages, 420000);
  const dest = path.join(path.dirname(filePath), path.basename(filePath, path.extname(filePath)) + '-refined.png');
  fs.writeFileSync(dest, out.buffer);
  return dest;
}

async function runHighResolutionPipeline(options = {}) {
  const { filePath, baseUrl, prepared, requestId, progress, readImageSize, requestJson, requestBuffer, uploadImage, collectImages, clean, chooseTargetDimensions } = options;
  const currentSize = readImageSize(filePath, {});
  const plan = prepared?.highResolutionPlan || chooseHighResolutionPlan(prepared?.technical || {}, currentSize.width, currentSize.height, prepared || {}, chooseTargetDimensions);
  if (!plan?.requested) return { path:filePath, plan:null, stages:[] };
  const stages = [];
  let current = filePath;
  let refineError = null;
  try {
    current = await latentRefineWithComfy(current, baseUrl, prepared, plan.stage1, requestId, progress, requestJson, requestBuffer, uploadImage, collectImages, clean);
    const size = readImageSize(current, {});
    stages.push({ stage:'latent-refine', ok:true, width:size.width, height:size.height, target:plan.stage1 });
  } catch (error) {
    refineError = String(error?.message || error);
    stages.push({ stage:'latent-refine', ok:false, error:refineError, target:plan.stage1 });
    progress?.(`High-Resolution 4K Pipeline: refine no disponible, usando exact-scale (${refineError})`);
  }
  const refinedSize = readImageSize(current, {});
  if (refinedSize.width !== plan.stage2.width || refinedSize.height !== plan.stage2.height) {
    current = await exactScaleWithComfy(current, baseUrl, plan.stage2.width, plan.stage2.height, requestId, progress, requestJson, requestBuffer, uploadImage, collectImages);
  }
  const finalSize = readImageSize(current, {});
  stages.push({ stage:'exact-scale', ok:true, width:finalSize.width, height:finalSize.height, target:plan.stage2, method:plan.stage2.method });
  return { path:current, plan, stages, refineError };
}

module.exports = { roundToMultiple, chooseHighResolutionPlan, runHighResolutionPipeline };
