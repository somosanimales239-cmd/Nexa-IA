'use strict';
const assert=require('assert');
const R=require('../lib/chat-routing-v190');
const tests=[
  ['el mismo perrito pero en un parque jugando con 4 gatos que tengan el mismo estilo de imagen que él',true,true],
  ['haz el mismo perrito jugando con 4 gatos',true,true],
  ['usa esta foto y ponlo en la playa',true,true],
  ['créame una imagen del mismo perrito jugando con 4 gatos',true,true],
  ['¿qué ves aquí?',false,false],
  ['describe esta imagen',false,true],
  ['compara estas dos fotos',false,false],
  ['hazme un resumen de este documento',false,false],
];
for(const [text,generate,reference] of tests){assert.strictEqual(R.shouldGenerateImage(text,true),generate,`generation mismatch: ${text}`);assert.strictEqual(R.wantsReference(text),reference,`reference mismatch: ${text}`);}
assert.strictEqual(R.isVisualQuestion('¿qué ves aquí?'),true);
assert.strictEqual(R.isVisualQuestion('describe esta imagen'),true);
assert.strictEqual(R.shouldGenerateImage('hazme un resumen',false),false);
console.log('Nexa v1.9.0 routing tests: OK');
