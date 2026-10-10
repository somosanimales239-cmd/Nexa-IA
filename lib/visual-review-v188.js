'use strict';

const Base = require('./visual-review-v185');

const MODEL = Base.MODEL;
const MAX_ATTEMPTS = Base.MAX_ATTEMPTS;
const THRESHOLD = 78;
const GREAT_THRESHOLD = 88;
const HARD_CRITICAL = new Set(['E001','E002','E003','E008','E009','E010','E018','E019']);
const SOFT_CODES = new Set(['E004','E005','E006','E007','E011','E012','E013','E014','E015','E016','E017']);
const WEIGHTS = Object.freeze({subject_identity:20,subject_count:15,species_identity:15,requested_attributes:12,pose_action:8,style:10,framing:10,anatomy:7,background:3,text_integrity:2,technical_quality:3});

const SCHEMA = Object.freeze({
  ...Base.SCHEMA,
  properties:{
    ...Base.SCHEMA.properties,
    reference_match:{type:'string',enum:['pass','fail','uncertain','na']},
    reference_identity_score:{type:'number',minimum:0,maximum:1},
    reference_style_score:{type:'number',minimum:0,maximum:1},
    reference_composition_score:{type:'number',minimum:0,maximum:1},
  },
  required:[...Base.SCHEMA.required,'reference_match','reference_identity_score','reference_style_score','reference_composition_score'],
});

let referenceContext=null;
function clean(v,max=12000){return String(v||'').replace(/\s+/g,' ').trim().slice(0,max);}
function uniq(arr,max=40){const out=[],seen=new Set();for(const x of Array.isArray(arr)?arr:[]){const v=clean(x,220);if(!v||seen.has(v.toLowerCase()))continue;seen.add(v.toLowerCase());out.push(v);if(out.length>=max)break;}return out;}
function merge(base,adds){const xs=uniq(adds);return [clean(base),...xs].filter(Boolean).join(', ');}
function state(v){const x=String(v||'').toLowerCase();return ['pass','fail','uncertain','na'].includes(x)?x:'uncertain';}
function setReferenceContext(ctx){referenceContext=ctx&&typeof ctx==='object'?JSON.parse(JSON.stringify(ctx)):null;}
function clearReferenceContext(){referenceContext=null;}
function getReferenceContext(){return referenceContext?JSON.parse(JSON.stringify(referenceContext)):null;}

function deriveVisualSpec(userRequest){
  const base=Base.deriveVisualSpec(userRequest);
  const text=clean(userRequest,7000).toLowerCase();
  const species=[
    ['dog',/\b(dog|puppy|puppies|perro|perrito|perrita|cachorro|cachorrito)\b/],
    ['cat',/\b(cat|kitten|gato|gata|gatito|gatita)\b/],
    ['rabbit',/\b(rabbit|bunny|conejo|conejito)\b/],
    ['fox',/\b(fox|zorro|zorrito)\b/],
    ['bear',/\b(bear|oso|osito)\b/],
    ['lion',/\b(lion|leon|león)\b/],
    ['tiger',/\b(tiger|tigre)\b/],
    ['horse',/\b(horse|caballo)\b/],
    ['bird',/\b(bird|pajaro|pájaro|ave)\b/],
    ['kangaroo',/\b(kangaroo|canguro|kanguro)\b/],
  ];
  for(const [name,re] of species){if(re.test(text)){base.requested_species=name;break;}}
  if(base.exact_subject_count===null && /\b(a|an|one|un|una)\s+(?:very\s+|super\s+|bien\s+|muy\s+)?(?:cute\s+|adorable\s+|small\s+|pequeñ[oa]\s+)?(dog|puppy|perro|perrito|perrita|cachorro|cat|kitten|gato|gatito|rabbit|bunny|conejo|fox|zorro|bear|oso|kangaroo|canguro|kanguro)\b/.test(text)) base.exact_subject_count=1;
  if(/\b(pixar|family animation|animated family film|pelicula animada|película animada|3d animated|animado 3d)\b/.test(text)) base.requested_style='3d_animation';
  if(/\b(cute|adorable|tierno|tierna|kawaii)\b/.test(text)) base.requested_mood='cute';
  return base;
}

function categoryFor(spec,text){
  if(spec.requested_species) return 'animal';
  if(/\b(car|auto|coche|carro|truck|suv|vehicle|vehiculo|vehículo)\b/i.test(text)) return 'vehicle';
  if(/\b(product|producto|bottle|box|package|shoe|watch|reloj)\b/i.test(text)) return 'product';
  if(/\b(person|woman|man|girl|boy|persona|mujer|hombre|niña|niño|portrait|retrato)\b/i.test(text)) return 'human';
  return 'general';
}

function referenceHints(){
  const ctx=referenceContext;if(!ctx?.enabled)return {positive:[],negative:[],summary:''};
  const cfg=ctx.config||{},dna=ctx.dna||{};const pos=[],neg=[];
  const mode=String(cfg.mode||'consistency');
  pos.push(`reference consistency mode ${mode}`,`reference identity priority ${Number(cfg.identityWeight)||90}/100`,`reference style priority ${Number(cfg.styleWeight)||65}/100`);
  if(mode!=='style'){
    for(const x of dna.identity_traits||[])pos.push(`preserve identity trait: ${x}`);
    for(const x of dna.markings||[])pos.push(`preserve marking: ${x}`);
    for(const x of dna.proportions||[])pos.push(`preserve proportion: ${x}`);
    for(const x of dna.colors||[])pos.push(`preserve reference color: ${x}`);
  }
  if(mode==='style'||mode==='consistency')for(const x of dna.style_traits||[])pos.push(`reference style: ${x}`);
  if(mode==='composition')for(const x of dna.composition_traits||[])pos.push(`reference composition: ${x}`);
  for(const x of dna.preserve||[])pos.push(`must preserve from reference: ${x}`);
  for(const x of dna.avoid||[])neg.push(x);
  neg.push('identity drift','different fur markings','different face proportions','unrequested species change','reference mismatch');
  return {positive:uniq(pos,32),negative:uniq(neg,22),summary:uniq(pos,12).join(' | ')};
}

function compilePremiumBrief(userRequest){
  const original=clean(userRequest,7000);const spec=deriveVisualSpec(original);const category=categoryFor(spec,original);const pos=[],neg=[];
  pos.push(original,'one coherent finished image','professional composition','clean readable silhouette','clear focal subject','high visual clarity','polished final render');
  if(spec.exact_subject_count===1)pos.push('exactly one main subject','single subject only','one pose only');
  if(spec.requested_species)pos.push(`unmistakable ${spec.requested_species} identity`,`species-correct anatomy and silhouette`);
  if(spec.requested_mood==='cute')pos.push('extremely cute and appealing','warm friendly expression','large expressive eyes','soft rounded appealing shapes','charming lovable personality');
  if(spec.requested_style==='3d_animation')pos.push('high-end stylized 3D animated family-film aesthetic','soft global illumination','cinematic soft lighting','polished character rendering','subtle depth of field','appealing feature-animation proportions');
  else if(spec.requested_style==='cartoon')pos.push('polished cartoon illustration','clean appealing character design','controlled vibrant palette');
  else if(spec.requested_style==='anime')pos.push('polished anime illustration','clean linework','coherent cel shading');
  else if(spec.requested_style==='photorealistic')pos.push('photorealistic','natural materials and lighting','realistic detail');
  if(spec.requested_framing==='close')pos.push('close framing','subject fills most of frame','clean head-and-body separation');
  if(spec.requested_framing==='full_body')pos.push('full body entirely visible','head to toe inside frame','comfortable margin around subject');
  if(spec.requested_pose)pos.push(spec.requested_pose,'clear readable action');
  pos.push(...(spec.requested_attributes||[]).map(x=>`${x} clearly visible`));
  neg.push('blurry','low quality','low detail','bad anatomy','deformed anatomy','extra limbs','missing limbs','duplicate subject','cloned subject','cropped head','accidental crop','text','watermark','logo artifact','messy composition','unwanted extra objects','character sheet','turnaround sheet','reference sheet','multiple views','multiple poses','collage');
  if(category==='animal')neg.push('wrong species','hybrid animal','deformed muzzle','malformed ears','bad paws','extra paws','human face on animal','uncanny creature');
  if(category==='human')neg.push('extra fingers','bad hands','crossed eyes','duplicate person','deformed face');
  if(category==='vehicle')neg.push('duplicate vehicle','extra wheels','deformed wheels','warped body panels','incorrect vehicle geometry');
  if(category==='product')neg.push('duplicate product','distorted product shape','wrong proportions','clutter hiding product');
  if(spec.exact_subject_count===1)neg.push('second subject','multiple characters','multiple animals','group scene');
  const ref=referenceHints();pos.push(...ref.positive);neg.push(...ref.negative);
  const dim=targetDimensions(original);
  return {original,positive:uniq(pos,48).join(', '),negative:uniq(neg,48).join(', '),width:dim?.width||896,height:dim?.height||896,style:spec.requested_style||'auto',category,visualSpec:spec,referenceEnabled:!!referenceContext?.enabled};
}

function targetDimensions(userRequest){
  const spec=deriveVisualSpec(userRequest);if(spec.requested_framing==='close')return{width:896,height:896};if(spec.requested_framing==='full_body')return{width:768,height:1024};
  const text=clean(userRequest,6000).toLowerCase();if(/\b(car|auto|coche|carro|truck|camion|camión|suv|vehicle|vehiculo|vehículo)\b/.test(text))return{width:1024,height:768};
  if(spec.requested_style==='cartoon'||spec.requested_style==='anime'||spec.requested_style==='3d_animation'||spec.requested_species)return{width:896,height:896};return null;
}

function augmentInitialRequest(userRequest){
  const premium=compilePremiumBrief(userRequest);
  return [
    `ORIGINAL USER REQUEST: ${premium.original}`,
    `PREMIUM POSITIVE PROMPT: ${premium.positive}`,
    `PREMIUM NEGATIVE PROMPT: ${premium.negative}`,
    `IMAGE PARAMETERS: ${premium.width}x${premium.height}; style=${premium.style}; category=${premium.category}.`,
    'IMPORTANT: Build the generation plan from the PREMIUM POSITIVE PROMPT and PREMIUM NEGATIVE PROMPT. Do not add extra subjects, multiple poses, a character sheet, or unrelated objects.'
  ].join('\n');
}

function initialConstraints(plan,userRequest){
  const base=Base.initialConstraints(plan,userRequest);const premium=compilePremiumBrief(userRequest);
  return {...base,width:premium.width,height:premium.height,positive_prompt:merge(premium.positive, [base.positive_prompt||base.positivePrompt]),negative_prompt:merge(premium.negative,[base.negative_prompt||base.negativePrompt]),premium_compiler:true,referenceConsistency:referenceContext?.enabled?{enabled:true,mode:referenceContext.config?.mode||'consistency',count:referenceContext.count||0}:null};
}

function evaluationPrompt(userRequest,plan,attempt){
  let p=Base.evaluationPrompt(userRequest,plan,attempt);
  p+='\nV1.8.8 RULE: UNCERTAIN IS NOT A FAILURE. Use fail only for a clear visible contradiction.';
  p+='\nPose, framing, style nuance and background preference are soft unless the user explicitly says they are mandatory.';
  if(referenceContext?.enabled){
    const ref=referenceHints();
    p+=`\nREFERENCE MODE: ${referenceContext.config?.mode||'consistency'}. REFERENCE VISUAL DNA: ${ref.summary}`;
    p+='\nSet reference_match to pass/fail/uncertain and score identity/style/composition from 0 to 1. If likeness/consistency is requested, compare visible identity traits, markings, proportions and colors. A clearly different subject identity is a fail; minor artistic variation is not.';
  } else p+='\nNo reference images are active. Set reference_match=na and all reference scores=0.';
  return p;
}

function finalizeEvaluation(raw,userRequest,threshold=THRESHOLD){
  const base=Base.finalizeEvaluation(raw,userRequest,Base.THRESHOLD);const codes=new Set(base.error_codes||[]);
  if(state(base.subject_identity)==='uncertain')codes.delete('E001');
  if(state(base.subject_count)==='uncertain'&&!(Number(base.detected_subject_count)>0&&base.visual_spec?.exact_subject_count!==null&&Number(base.detected_subject_count)!==Number(base.visual_spec.exact_subject_count)))codes.delete('E002');
  if(state(base.species_identity)==='uncertain')codes.delete('E008');
  if(state(base.requested_attributes)==='uncertain')codes.delete('E010');
  if(state(base.style)!=='fail')codes.delete('E007');
  if(state(base.framing)!=='fail')codes.delete('E017');
  if(state(base.pose_action)!=='fail')codes.delete('E016');
  let possible=0,earned=0;
  for(const [key,w] of Object.entries(WEIGHTS)){const v=state(base[key]);if(v==='na')continue;possible+=w;if(v==='pass')earned+=w;else if(v==='uncertain')earned+=w*0.75;else if(v==='fail'){const map={subject_identity:'E001',subject_count:'E002',species_identity:'E008',requested_attributes:'E010',pose_action:'E016',style:'E007',framing:'E017',anatomy:'E009',background:'E012',text_integrity:'E013',technical_quality:'E014'};earned+=w*(HARD_CRITICAL.has(map[key])?0:0.4);}}
  let score=possible?Math.round(earned/possible*100):0;
  const refActive=!!referenceContext?.enabled;const refMatch=state(raw?.reference_match);const refIdentity=Math.max(0,Math.min(1,Number(raw?.reference_identity_score)||0));const refStyle=Math.max(0,Math.min(1,Number(raw?.reference_style_score)||0));const refComp=Math.max(0,Math.min(1,Number(raw?.reference_composition_score)||0));
  if(refActive){const cfg=referenceContext.config||{};const mode=String(cfg.mode||'consistency');const iw=(Number(cfg.identityWeight)||90)/100,sw=(Number(cfg.styleWeight)||65)/100,cw=(Number(cfg.compositionWeight)||40)/100;const denom=iw+sw+cw||1;const refScore=Math.round(((refIdentity*iw+refStyle*sw+refComp*cw)/denom)*100);score=Math.round(score*0.78+refScore*0.22);const strict=['likeness','consistency','product'].includes(mode);if(strict&&(refMatch==='fail'||refIdentity<0.48))codes.add('E019');}
  const error_codes=[...codes];const critical_errors=error_codes.filter(x=>HARD_CRITICAL.has(x));const soft_errors=error_codes.filter(x=>SOFT_CODES.has(x));const safe=Math.max(70,Math.min(92,Number(threshold)||THRESHOLD));
  return {...base,error_codes,critical_errors,soft_errors,critical:critical_errors.length>0,score,threshold:safe,quality_band:score>=GREAT_THRESHOLD?'great':score>=safe?'good':score>=68?'usable':'poor',pass:critical_errors.length===0&&score>=safe,uncertain_is_failure:false,reference_match:refActive?refMatch:'na',reference_identity_score:refIdentity,reference_style_score:refStyle,reference_composition_score:refComp};
}

function applyRepairs(plan,evaluation,userRequest,nextAttempt){
  const repaired=Base.applyRepairs(plan,evaluation,userRequest,nextAttempt);const premium=compilePremiumBrief(userRequest);let positive=[repaired.positive_prompt||repaired.positivePrompt,premium.positive],negative=[repaired.negative_prompt||repaired.negativePrompt,premium.negative];
  if((evaluation?.error_codes||[]).includes('E019')){const ref=referenceHints();positive.push('strongly preserve the reference subject identity','match distinctive reference markings, face shape, proportions and colors',...ref.positive);negative.push('identity drift','different subject design','changed markings','changed facial proportions',...ref.negative);}
  return {...repaired,positive_prompt:positive.filter(Boolean).join(', '),negative_prompt:negative.filter(Boolean).join(', '),premium_compiler:true};
}

function summary(evaluation,attempts){if(!evaluation)return'Nexa Visual: sin evaluación.';if(evaluation.reviewUnavailable)return'Nexa Visual: REVIEW UNAVAILABLE · render conservado.';const stateText=evaluation.pass?'APROBADA':'MEJOR RESULTADO';const hard=evaluation.critical_errors?.length?` · hard: ${evaluation.critical_errors.join(', ')}`:'';const soft=evaluation.soft_errors?.length?` · soft: ${evaluation.soft_errors.join(', ')}`:'';const ref=referenceContext?.enabled?` · ref ${Math.round((evaluation.reference_identity_score||0)*100)}%`:'';return`Nexa Visual ${stateText} · ${evaluation.score}/100 · ${attempts} intento${attempts===1?'':'s'}${ref}${hard}${soft}`;}

module.exports={...Base,MODEL,MAX_ATTEMPTS,THRESHOLD,GREAT_THRESHOLD,SCHEMA,CRITICAL_ERRORS:HARD_CRITICAL,setReferenceContext,clearReferenceContext,getReferenceContext,deriveVisualSpec,compilePremiumBrief,targetDimensions,augmentInitialRequest,initialConstraints,evaluationPrompt,finalizeEvaluation,applyRepairs,summary};
