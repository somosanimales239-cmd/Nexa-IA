'use strict';
const assert=require('assert');
const Compiler=require('../lib/premium-prompt-compiler-v189');
const Guard=require('../lib/prompt-drift-guard-v194');

Guard.install(Compiler);

const exact='Chica anime con cabello negro largo y ondulado, pose dinámica en medio de una escena de batalla, sus puños están levantados, líneas de movimiento resaltan la velocidad. Fondo de un paisaje urbano de noche con luces de neón, sombras contrastantes y trazos de humo. La paleta incluye azules profundos, naranjas vibrantes y blanco. Técnica de dibujo lineal fina, cel shading y relleno de color sólido.';
const a=Guard.analyze(exact);
assert(a.dynamic===true);
assert(a.action.length>0);
assert(a.environment.length>0);
assert(a.rendering.length>0);
const compiled=Compiler.compile(exact,{});
assert(/constraint fusion/i.test(compiled.positivePrompt));
assert(/requested pose\/action remains clearly readable/i.test(compiled.positivePrompt));
assert(/requested environment\/background remains visibly recognizable/i.test(compiled.positivePrompt));
assert(/requested visual\/rendering language remains consistent/i.test(compiled.positivePrompt));
assert(/static portrait/i.test(compiled.negativePrompt));
assert(/generic blurred background/i.test(compiled.negativePrompt));
assert(compiled.hardRequirements.some(x=>/action\/pose must remain visibly readable/i.test(x)));
assert(compiled.hardRequirements.some(x=>/environment\/background must remain visibly present/i.test(x)));
assert(compiled.hardRequirements.some(x=>/rendering\/style treatment must remain visibly present/i.test(x)));

const mixed='A beautiful warrior girl in detailed armor, dynamic fighting pose, holding a sword, city at night with neon signs, smoke, full body, sharp anime line art and cel shading.';
const m=Compiler.compile(mixed,{});
assert(/simultaneously read as attractive\/appealing AND as the requested role/i.test(m.positivePrompt));
assert(/generic beauty portrait without the requested role/i.test(m.negativePrompt));
assert(m.hardRequirements.some(x=>/appearance and role are simultaneous requirements/i.test(x)));

const simple='a red sports car parked on a clean studio floor';
const s=Compiler.compile(simple,{});
assert(/constraint fusion/i.test(s.positivePrompt));
assert(!/static portrait/i.test(s.negativePrompt));

console.log('Nexa AI v1.9.4 Prompt Drift Guard tests: OK');
