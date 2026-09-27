'use strict';

const assert = require('assert');
const Writer = require('../lib/visual-prompt-writer-v193');

const first = 'creame un promt master para hacer una imagen de un personage que se parescan a Naruto la idea es que tenga lineas de arte detras';
const second = 'creame un promt master para hacer una imagen de un personage el personage es un chica con cabello negro que sea similar al estilo de dibujo de las caricatura de Naruto';

assert.strictEqual(Writer.isVisualPromptRequest(first), true);
assert.strictEqual(Writer.isVisualPromptRequest(second), true);
assert.strictEqual(Writer.isVisualPromptRequest('Explícame qué es un prompt'), false);

const adapted = Writer.adaptSimilarityRequest(second);
assert.strictEqual(adapted.similarity, true);
assert.ok(/shonen|anime/i.test(adapted.adapted));
assert.ok(!/\bnaruto\b/i.test(adapted.adapted), 'Naruto should be translated into visual traits for the internal fallback.');
assert.ok(!/promt master|prompt master/i.test(adapted.adapted), 'Chat wrapper language should not leak into the image prompt.');
assert.ok(/original/i.test(adapted.adapted));

const pack = Writer.compilePromptPackage(first);
assert.ok(pack.positivePrompt.length > 100);
assert.ok(pack.negativePrompt.length > 80);
assert.ok(/line|línea|speed/i.test(pack.positivePrompt));
assert.ok(/copia exacta|exact copy/i.test(pack.negativePrompt));
assert.strictEqual(pack.style, 'anime');
assert.strictEqual(pack.width, 768);
assert.strictEqual(pack.height, 1024);

assert.strictEqual(Writer.responseLooksRejected('I’m sorry, but I can’t help with that.'), true);
assert.strictEqual(Writer.responseLooksRejected('Aquí tienes el prompt positivo premium: ...'), false);
assert.strictEqual(Writer.fallbackAllowed('personaje anime similar a Naruto'), true);
assert.strictEqual(Writer.fallbackAllowed('prompt sexual de un child desnudo'), false);

function runSenderCase(userText, packets) {
  const sent = [];
  const fakeSender = {
    send(channel, packet) { sent.push({ channel, packet }); },
    isDestroyed() { return false; },
  };
  const proxy = Writer.senderProxy(fakeSender, 'req-1', userText, '1.9.3');
  for (const [channel, packet] of packets) proxy.send(channel, packet);
  return sent;
}

const refused = runSenderCase(first, [
  ['chat:token', { requestId:'req-1', content:'I’m sorry, but I can’t help with that.' }],
  ['chat:done', { requestId:'req-1', stats:{} }],
]);
const refusedText = refused.filter(x => x.channel === 'chat:token').map(x => x.packet.content).join('');
assert.ok(/Prompt positivo premium/i.test(refusedText));
assert.ok(/Prompt negativo premium/i.test(refusedText));
assert.ok(!/can.t help with that/i.test(refusedText));
assert.strictEqual(refused.filter(x => x.channel === 'chat:done').length, 1);

const accepted = runSenderCase(first, [
  ['chat:token', { requestId:'req-1', content:'Aquí tienes un prompt master completo.' }],
  ['chat:done', { requestId:'req-1', stats:{} }],
]);
assert.strictEqual(accepted.filter(x => x.channel === 'chat:token')[0].packet.content, 'Aquí tienes un prompt master completo.');
assert.strictEqual(accepted.filter(x => x.channel === 'chat:done').length, 1);

const otherRequest = runSenderCase(first, [
  ['chat:token', { requestId:'different', content:'untouched' }],
]);
assert.strictEqual(otherRequest[0].packet.content, 'untouched');

console.log('Nexa AI v1.9.3 Visual Prompt Writer tests: OK');
