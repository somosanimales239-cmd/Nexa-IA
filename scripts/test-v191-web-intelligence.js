'use strict';
const assert=require('assert');
const W=require('../lib/web-intelligence-v191');
function p(q){return W.deterministicPlan(q);}
assert.equal(p('¿Cuánto es 2+2?').web_required,false);
assert.equal(p('Escríbeme un email para pedir una entrevista').web_required,false);
assert.equal(p('Explícame qué es una variable en programación').web_required,false);
assert.equal(p('Busca si salió una nueva versión de Ollama').web_required,true);
assert.equal(p('¿Cuál es la versión actual de Ollama?').web_required,true);
assert.equal(p('¿Cuál es el torque del intake manifold del Toyota Corolla 2021 2.0L M20A-FKS?').web_required,true);
assert.equal(p('Verifica el TSB para P0301 en Corolla 2021').web_required,true);
assert.equal(p('¿Cuál es el precio actual de una RTX 5070?').web_required,true);
assert.equal(W.inferIntent('Toyota Corolla 2021 M20A-FKS torque'),'automotive_technical');
assert.equal(W.inferIntent('latest Ollama GitHub release'),'software_technical');
assert.ok(W.targetedQueries('Toyota Corolla torque','automotive_technical').some(q=>/nhtsa/i.test(q)));
assert.ok(W.sourceScore({url:'https://www.nhtsa.gov/test',title:'Toyota Corolla',snippet:''},{intent:'automotive_technical',preferred_domains:[]},'Toyota Corolla') > W.sourceScore({url:'https://www.reddit.com/r/cars/x',title:'Toyota Corolla',snippet:''},{intent:'automotive_technical',preferred_domains:[]},'Toyota Corolla'));
const normalized=W.normalizePlan({web_required:false,local_confidence:0.3,intent:'general_fact',queries:['rare exact fact']},'What is this rare exact fact?',p('What is this rare exact fact?'));
assert.equal(normalized.web_required,true);

assert.ok(W.researchSystemMessage('question',{intent:'general_fact'},{status:'VERIFIED',confidence:0.9,facts:['fact'],conflicts:[],caveats:[],selected_sources:[1]},[{title:'Official',url:'https://example.gov/fact',text:'fact evidence'}]).includes('Base: Web Intelligence'));
console.log('Nexa AI v1.9.1 Web Intelligence routing/planner tests: OK');
