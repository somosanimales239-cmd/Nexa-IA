'use strict';
const assert=require('assert');
const I=require('../lib/image-intelligence-v195');

assert.equal(I.isVisualCreationIntent('generame un personage de cartoon de un principe estilo disney de cuerpo completo'),true);
assert.equal(I.isVisualCreationIntent('creame un prompt para hacer una imagen de una guerrera'),false);
assert.equal(I.isVisualCreationIntent('explicame que es un personaje'),false);

const pasted=I.prepareRequest('generame una imagen con resolucion 4K de A realistic cinematic modern war-torn cityscape with ruined buildings. Negative Prompt: cartoon, anime, low resolution, text, watermark. Consejos de uso: CFG 8-10; Resolución 2048x3072');
assert.equal(pasted.style,'photorealistic');
assert.equal(pasted.technical.wants4k,true);
assert(!/Consejos de uso/i.test(pasted.positive));
assert(/anime/i.test(pasted.negative));
assert(/STRICT STYLE LOCK: photorealistic/i.test(pasted.positive));

const conflict=I.prepareRequest('creame una imagen anime de una chica. Negative Prompt: anime, manga, blurry, watermark');
assert.equal(conflict.style,'anime');
assert(!/(^|,\s*)anime(\s*,|$)/i.test(conflict.negative));

const disney=I.prepareRequest('generame un personaje cartoon de un principe estilo disney de cuerpo completo');
assert.equal(disney.similarityAdapted,true);
assert(!/\bdisney\b/i.test(disney.positive));
assert(/original/i.test(disney.positive));
assert(disney.requirements.some(x=>x.id==='originality'));
assert(disney.requirements.some(x=>x.id==='full_body'));

const tattoo=I.prepareRequest('guerrera con marcas indígenas, ropa moderna ajustada, pose de lucha, cuerpo completo, para tatuaje, fondo transparente');
assert.equal(tattoo.purpose,'tattoo');
assert.equal(tattoo.technical.transparent,true);
assert(tattoo.requirements.some(x=>x.id==='transparent'));
assert(/chroma green/i.test(tattoo.generationRequest));
assert(/tattoo-ready/i.test(tattoo.positive));

const target=I.chooseTargetDimensions({wants4k:true},1024,768);
assert.deepEqual({width:target.width,height:target.height},{width:3840,height:2880});
const exact=I.chooseTargetDimensions({exactWidth:3840,exactHeight:2160},1024,768);
assert.deepEqual({width:exact.width,height:exact.height},{width:3840,height:2160});

const fake={
  evaluationPrompt:()=> 'BASE',
  finalizeEvaluation:(raw)=>({style:raw.style||'uncertain',framing:raw.framing||'na',pose_action:raw.pose_action||'na',requested_attributes:raw.requested_attributes||'na',subject_identity:raw.subject_identity||'pass',error_codes:[],critical_errors:[],score:100,threshold:78,pass:true}),
  applyRepairs:(plan)=>({...plan,positive_prompt:plan.positive_prompt||'',negative_prompt:plan.negative_prompt||''}),
  summary:()=> 'summary',
};
I.installVisualReview(fake);
const realistic='NEXA IMAGE INTELLIGENCE v1.9.5\nCLEAN VISUAL REQUEST: realistic modern war-torn cityscape, full body\nCLEAN NEGATIVE REQUIREMENTS: anime\nSTYLE TARGET: photorealistic\nPURPOSE PROFILE: general\nHARD REQUIREMENTS: requested visual style must clearly read as photorealistic';
const ev=fake.finalizeEvaluation({style:'fail',framing:'pass',pose_action:'na',requested_attributes:'na',subject_identity:'pass'},realistic,78);
assert.equal(ev.pass,false);
assert(ev.critical_errors.includes('E007'));
assert(ev.score<=100);

const prompt=fake.evaluationPrompt('generame un personaje cartoon de un principe estilo disney de cuerpo completo',{},1);
assert(/recognizable existing franchise character/i.test(prompt));
assert(/EVERY requirement/i.test(prompt));

console.log('Nexa AI v1.9.5 Image Intelligence tests: OK');
