'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const I = require('../lib/image-intelligence-v198');

assert.equal(I.isVisualCreationIntent('generame un personage de cartoon de un principe estilo disney de cuerpo completo'), true);
assert.equal(I.isVisualCreationIntent('creame un prompt para hacer una imagen de una guerrera'), false);

const war = I.prepareRequest('generame una imagen con resolucion 4K de A realistic cinematic modern war-torn cityscape with ruined buildings. Negative Prompt: cartoon, anime, low resolution, text, watermark.');
assert.equal(war.style, 'photorealistic');
assert.equal(war.technical.wants4k, true);
assert(/STYLE AUTHORITY: photorealistic/i.test(war.generationRequest));

const warTarget = I.chooseTargetDimensions(war.technical, 1024, 768, war);
assert.deepEqual({ width: warTarget.width, height: warTarget.height }, { width: 3840, height: 2160 });

const high = I.chooseHighResolutionPlan(war.technical, 1024, 768, war);
assert.equal(high.stage1.width, 1600);
assert.equal(high.stage1.height, 896);
assert.equal(high.stage2.width, 3840);
assert.equal(high.stage2.height, 2160);
assert.equal(high.mode, 'adaptive-high-resolution-4k-pipeline');
assert.equal(high.stage1.maxWaitMs, 25 * 60 * 1000);

const fullBody = I.prepareRequest('generame una imagen 4k de una guerrera de cuerpo completo con fondo transparente');
const fullTarget = I.chooseTargetDimensions(fullBody.technical, 768, 1024, fullBody);
assert.deepEqual({ width: fullTarget.width, height: fullTarget.height }, { width: 2160, height: 3840 });
const fullPlan = I.chooseHighResolutionPlan(fullBody.technical, 768, 1024, fullBody);
assert.equal(fullPlan.stage1.width, 960);
assert.equal(fullPlan.stage1.height, 1664);

assert.equal(I.classifyCheckpoint('animagine-xl-v3.safetensors'), 'anime');
assert.equal(I.classifyCheckpoint('realvisxl_v5.safetensors'), 'photorealistic');
assert.equal(I.classifyCheckpoint('sdxl_base_1.0.safetensors'), 'general');

let route = I.chooseCheckpointForStyle('photorealistic', ['animagine-xl-v3.safetensors', 'realvisxl_v5.safetensors', 'sdxl_base_1.0.safetensors'], '');
assert.equal(route.resolvedCheckpoint, 'realvisxl_v5.safetensors');
route = I.chooseCheckpointForStyle('anime', ['animagine-xl-v3.safetensors', 'realvisxl_v5.safetensors', 'sdxl_base_1.0.safetensors'], '');
assert.equal(route.resolvedCheckpoint, 'animagine-xl-v3.safetensors');

const main = fs.readFileSync(path.join(__dirname, '..', 'main-v198.js'), 'utf8');
assert(main.includes('recoverTimedOutGeneration'));
assert(main.includes('Comfy History Rescue'));
assert(main.includes('Intentando recuperar la salida reciente'));

I.prepareRuntimePlan('generame una imagen realista 4K de una ciudad en ruinas', { comfyBaseUrl:'http://127.0.0.1:1', comfyCheckpoint:'realvisxl_v5.safetensors' }).then(plan => {
  assert.equal(plan.runtime.resolvedCheckpoint, 'realvisxl_v5.safetensors');
  assert(/COMFY CHECKPOINT DECISION/i.test(plan.generationRequest));
  assert(/HIGH-RES PIPELINE/i.test(plan.generationRequest));
  console.log('Nexa AI v1.9.8 completion-safe 4K pipeline tests: OK');
}).catch(err => {
  console.error(err);
  process.exit(1);
});
