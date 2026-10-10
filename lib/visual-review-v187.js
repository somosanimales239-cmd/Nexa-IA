'use strict';

// v1.8.7 extends the stable v1.8.5 evaluator without replacing its parser,
// Qwen recovery logic, prompt repairs, retry selection, or schema.
const Base = require('./visual-review-v185');

const baseFns = {
  deriveVisualSpec: Base.deriveVisualSpec,
  initialConstraints: Base.initialConstraints,
  evaluationPrompt: Base.evaluationPrompt,
  finalizeEvaluation: Base.finalizeEvaluation,
  applyRepairs: Base.applyRepairs,
  bestAttempt: Base.bestAttempt,
  summary: Base.summary,
  targetDimensions: Base.targetDimensions,
  augmentInitialRequest: Base.augmentInitialRequest,
};

const THRESHOLD = 78;
const GREAT_THRESHOLD = 88;
const HARD_CRITICAL = new Set(['E001','E002','E003','E008','E009','E010','E018']);
const SOFT_CODES = new Set(['E004','E005','E006','E007','E011','E012','E013','E014','E015','E016','E017']);

const WEIGHTS = Object.freeze({
  subject_identity:20,
  subject_count:15,
  species_identity:15,
  requested_attributes:12,
  pose_action:8,
  style:10,
  framing:10,
  anatomy:7,
  background:3,
  text_integrity:2,
  technical_quality:3,
});

let referenceContext = null;

function clean(value, max=8000) {
  return String(value || '').replace(/\s+/g,' ').trim().slice(0,max);
}

function setReferenceContext(ctx) {
  referenceContext = ctx && typeof ctx === 'object' ? JSON.parse(JSON.stringify(ctx)) : null;
}
function clearReferenceContext() { referenceContext = null; }
function getReferenceContext() { return referenceContext ? JSON.parse(JSON.stringify(referenceContext)) : null; }

function state(value) {
  const v=String(value||'').toLowerCase();
  return ['pass','fail','uncertain','na'].includes(v) ? v : 'uncertain';
}

function referenceHints() {
  const ctx=referenceContext;
  if(!ctx || !ctx.enabled) return [];
  const cfg=ctx.config || {};
  const dna=ctx.dna || {};
  const hints=[];
  const strength=Math.max(0,Math.min(100,Number(cfg.strength)||65));
  const identity=Math.max(0,Math.min(100,Number(cfg.identityWeight)||80));
  const style=Math.max(0,Math.min(100,Number(cfg.styleWeight)||60));
  const composition=Math.max(0,Math.min(100,Number(cfg.compositionWeight)||50));
  const mode=String(cfg.mode||'consistency');

  hints.push(`reference mode ${mode}; overall reference strength ${strength}/100`);
  if(mode==='likeness' || mode==='consistency' || mode==='product') {
    hints.push(`preserve reference identity with priority ${identity}/100`);
    for(const x of (dna.identity_traits||[]).slice(0,10)) hints.push(`reference identity: ${clean(x,180)}`);
    for(const x of (dna.markings||[]).slice(0,8)) hints.push(`reference marking/detail: ${clean(x,180)}`);
    for(const x of (dna.proportions||[]).slice(0,7)) hints.push(`reference proportion: ${clean(x,180)}`);
    for(const x of (dna.colors||[]).slice(0,8)) hints.push(`reference color: ${clean(x,120)}`);
  }
  if(mode==='style' || mode==='consistency') {
    hints.push(`preserve reference visual style with priority ${style}/100`);
    for(const x of (dna.style_traits||[]).slice(0,8)) hints.push(`reference style: ${clean(x,180)}`);
  }
  if(mode==='composition' || mode==='consistency') {
    hints.push(`use reference composition with priority ${composition}/100`);
    for(const x of (dna.composition_traits||[]).slice(0,6)) hints.push(`reference composition: ${clean(x,180)}`);
  }
  for(const x of (dna.preserve||[]).slice(0,8)) hints.push(`must preserve from reference: ${clean(x,180)}`);
  return hints.filter(Boolean);
}

function addReferenceToText(text) {
  const hints=referenceHints();
  if(!hints.length) return text;
  return `${text}. Nexa reference consistency: ${hints.join(', ')}.`;
}

function addReferenceToPlan(plan) {
  const hints=referenceHints();
  if(!hints.length) return plan;
  const base=clean(plan?.positive_prompt || plan?.positivePrompt,12000);
  const avoid=(referenceContext?.dna?.avoid || []).slice(0,8).map(x=>clean(x,160)).filter(Boolean);
  const neg=clean(plan?.negative_prompt || plan?.negativePrompt,10000);
  return {
    ...plan,
    positive_prompt: [base,...hints].filter(Boolean).join(', '),
    negative_prompt: [neg,...avoid].filter(Boolean).join(', '),
    referenceConsistency: {
      enabled:true,
      mode:String(referenceContext?.config?.mode||'consistency'),
      count:Number(referenceContext?.count||0),
    },
  };
}

function augmentInitialRequest(userRequest) {
  return addReferenceToText(baseFns.augmentInitialRequest(userRequest));
}

function initialConstraints(plan,userRequest) {
  return addReferenceToPlan(baseFns.initialConstraints(plan,userRequest));
}

function applyRepairs(plan,evaluation,userRequest,nextAttempt) {
  const repaired=baseFns.applyRepairs(plan,evaluation,userRequest,nextAttempt);
  const useInRetries=referenceContext?.config?.useInRetries !== false;
  return useInRetries ? addReferenceToPlan(repaired) : repaired;
}

function evaluationPrompt(userRequest,plan,attempt) {
  let prompt=baseFns.evaluationPrompt(userRequest,plan,attempt);
  const hints=referenceHints();
  if(hints.length) {
    prompt += '\nREFERENCE VISUAL DNA: ' + hints.join(' | ');
    prompt += '\nReference similarity is a preference unless the user explicitly asked to match the reference. Do not reject a good image merely because likeness is not exact.';
  }
  prompt += '\nIMPORTANT v1.8.7 DECISION RULE: use uncertain when evidence is ambiguous. UNCERTAIN IS NOT A FAILURE. Only use fail when a visible contradiction is clear.';
  return prompt;
}

function finalizeEvaluation(raw,userRequest,threshold=THRESHOLD) {
  // Let v1.8.5 normalize the schema and derive its diagnostic codes first.
  const base=baseFns.finalizeEvaluation(raw,userRequest,THRESHOLD);
  const result={...base};
  const codes=new Set(Array.isArray(base.error_codes)?base.error_codes:[]);

  // Undo v1.8.5's over-aggressive uncertain=>failure conversion.
  if(state(base.subject_identity)==='uncertain') codes.delete('E001');
  if(state(base.subject_count)==='uncertain' && !(Number(base.detected_subject_count)>0 && base.visual_spec?.exact_subject_count!==null && Number(base.detected_subject_count)!==Number(base.visual_spec.exact_subject_count))) codes.delete('E002');
  if(state(base.species_identity)==='uncertain') codes.delete('E008');
  if(state(base.requested_attributes)==='uncertain') codes.delete('E010');
  if(state(base.style)==='uncertain') codes.delete('E007');
  if(state(base.framing)==='uncertain') codes.delete('E017');
  if(state(base.pose_action)==='uncertain') codes.delete('E016');

  // Soft checks only become codes on explicit fail; they never become critical.
  if(state(base.style)!=='fail') codes.delete('E007');
  if(state(base.framing)!=='fail') codes.delete('E017');
  if(state(base.pose_action)!=='fail') codes.delete('E016');

  let possible=0,earned=0;
  for(const [key,weight] of Object.entries(WEIGHTS)) {
    const v=state(base[key]);
    if(v==='na') continue;
    possible+=weight;
    if(v==='pass') earned+=weight;
    else if(v==='uncertain') earned+=weight*0.72;
    else if(v==='fail') {
      const codeByKey={
        subject_identity:'E001',subject_count:'E002',species_identity:'E008',requested_attributes:'E010',
        pose_action:'E016',style:'E007',framing:'E017',anatomy:'E009',background:'E012',text_integrity:'E013',technical_quality:'E014'
      };
      earned+=weight*(HARD_CRITICAL.has(codeByKey[key])?0:0.35);
    }
  }
  const score=possible?Math.max(0,Math.min(100,Math.round(earned/possible*100))):0;
  const error_codes=[...codes];
  const critical_errors=error_codes.filter(code=>HARD_CRITICAL.has(code));
  const soft_errors=error_codes.filter(code=>SOFT_CODES.has(code));
  const safeThreshold=Math.max(70,Math.min(95,Number(threshold)||THRESHOLD));

  return {
    ...result,
    error_codes,
    critical_errors,
    soft_errors,
    critical:critical_errors.length>0,
    score,
    threshold:safeThreshold,
    quality_band: score>=GREAT_THRESHOLD?'great':score>=safeThreshold?'good':score>=68?'usable':'poor',
    pass:critical_errors.length===0 && score>=safeThreshold,
    uncertain_is_failure:false,
  };
}

function summary(evaluation,attempts) {
  if(!evaluation) return 'Nexa Visual: sin evaluación.';
  if(evaluation.reviewUnavailable) return 'Nexa Visual: REVIEW UNAVAILABLE · render conservado.';
  const stateText=evaluation.pass?'APROBADA':'MEJOR RESULTADO';
  const hard=evaluation.critical_errors?.length?` · hard: ${evaluation.critical_errors.join(', ')}`:'';
  const soft=evaluation.soft_errors?.length?` · soft: ${evaluation.soft_errors.join(', ')}`:'';
  return `Nexa Visual ${stateText} · ${evaluation.score}/100 · ${attempts} intento${attempts===1?'':'s'}${hard}${soft}`;
}

module.exports={
  ...Base,
  THRESHOLD,
  GREAT_THRESHOLD,
  CRITICAL_ERRORS:HARD_CRITICAL,
  setReferenceContext,
  clearReferenceContext,
  getReferenceContext,
  augmentInitialRequest,
  initialConstraints,
  applyRepairs,
  evaluationPrompt,
  finalizeEvaluation,
  summary,
};
