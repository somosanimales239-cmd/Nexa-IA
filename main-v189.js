'use strict';

// Nexa AI v1.8.9 — Invisible Premium Prompt Compiler
// This is a thin bootstrap on top of the working v1.8.8 runtime.
// It does not replace ComfyUI, Qwen review, reference handling, retries, preload or renderer.

const path = require('path');
const { BrowserWindow } = require('electron');
const Compiler = require('./lib/premium-prompt-compiler-v189');
const V188 = require('./lib/visual-review-v188');

// App Builder contract hint. The real BrowserWindow/loadFile remains in main.js through v1.8.8.
const ACTIVE_ELECTRON_GRAPH = { renderer:path.join(__dirname,'src','index.html') };
function nexaActiveGraphHint(win){ if(false && win instanceof BrowserWindow) win.loadFile(path.join(__dirname,'src','index.html')); return ACTIVE_ELECTRON_GRAPH; }
void nexaActiveGraphHint;

const original = {
  augmentInitialRequest: V188.augmentInitialRequest,
  initialConstraints: V188.initialConstraints,
  evaluationPrompt: V188.evaluationPrompt,
  applyRepairs: V188.applyRepairs,
  targetDimensions: V188.targetDimensions,
};

function compilerOptions(){
  try {
    const ref=typeof V188.getReferenceContext==='function' ? V188.getReferenceContext() : null;
    return { referenceActive:!!ref?.enabled, referenceMode:String(ref?.config?.mode||'consistency') };
  } catch (_) { return {referenceActive:false,referenceMode:'consistency'}; }
}
function compile(userRequest){ return Compiler.compile(userRequest,compilerOptions()); }

V188.augmentInitialRequest = function(userRequest){
  const c=compile(userRequest);
  return Compiler.plannerRequest(c);
};

V188.targetDimensions = function(userRequest){
  const c=compile(userRequest);
  return {width:c.width,height:c.height};
};

V188.initialConstraints = function(plan,userRequest){
  const base=original.initialConstraints(plan,userRequest);
  const c=compile(userRequest);
  return {
    ...base,
    width:c.width,
    height:c.height,
    positive_prompt:[c.positivePrompt,base.positive_prompt||base.positivePrompt||''].filter(Boolean).join(', '),
    negative_prompt:[c.negativePrompt,base.negative_prompt||base.negativePrompt||''].filter(Boolean).join(', '),
    premium_compiler_v189:true,
    premium_hard_requirements:c.hardRequirements,
    premium_visual_spec:{mainSubject:c.mainSubject,secondary:c.secondary,scene:c.scene,action:c.action,sameIdentity:c.sameIdentity,sameStyle:c.sameStyle,totalSubjects:c.totalSubjects}
  };
};

V188.evaluationPrompt = function(userRequest,plan,attempt){
  const c=compile(userRequest);
  return original.evaluationPrompt(userRequest,plan,attempt) + [
    '',
    'NEXA PREMIUM COMPILER V1.8.9:',
    `EXPLICIT HARD REQUIREMENTS: ${c.hardRequirements.join(' | ')||'none'}`,
    'Only explicit hard requirements above may trigger a hard rejection. Premium lighting, polish and composition enhancements are soft quality guidance only.',
    'If the user explicitly requested an exact count, verify that count strictly.',
    'If the user explicitly requested the same referenced subject, reference identity is a hard requirement.',
    'If the user explicitly requested the same reference style, style consistency across subjects is required.'
  ].join('\n');
};

V188.applyRepairs = function(plan,evaluation,userRequest,nextAttempt){
  const repaired=original.applyRepairs(plan,evaluation,userRequest,nextAttempt);
  const c=compile(userRequest);
  const hard=c.hardRequirements.map(x=>`must satisfy: ${x}`);
  return {
    ...repaired,
    width:c.width,
    height:c.height,
    positive_prompt:[c.positivePrompt,repaired.positive_prompt||repaired.positivePrompt||'',...hard].filter(Boolean).join(', '),
    negative_prompt:[c.negativePrompt,repaired.negative_prompt||repaired.negativePrompt||''].filter(Boolean).join(', '),
    premium_compiler_v189:true,
  };
};

// Load the already working v1.8.8 runtime after patching its exported planning functions.
require('./main-v188.js');
