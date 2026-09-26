'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const root = process.cwd();
const here = __dirname;
const mainPath = path.join(root, 'main.js');

function fail(message) {
  console.error('\nBUILD 106.2 ERROR: ' + message + '\n');
  process.exit(1);
}
function run(command, args, cwd = root) {
  const result = cp.spawnSync(command, args, { cwd, stdio:'inherit', shell:false });
  if (result.error || result.status !== 0) throw result.error || new Error(command + ' terminó con código ' + result.status);
}
function replaceIfPresent(text, from, to) {
  return text.includes(from) ? text.replace(from, to) : text;
}

for (const rel of ['main.js','preload.js','src/app.js','src/index.html','package.json']) {
  if (!fs.existsSync(path.join(root, rel))) fail('No encontré ' + rel + '. Este instalador debe ejecutarse en la raíz del código de Nexa.');
}

try {
  // Copy the stronger evaluator before validation/install.
  fs.mkdirSync(path.join(root, 'lib'), { recursive:true });
  fs.copyFileSync(path.join(here, 'lib', 'visual-evaluator.js'), path.join(root, 'lib', 'visual-evaluator.js'));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive:true });
  fs.copyFileSync(path.join(here, 'scripts', 'validate-visual-evaluator.js'), path.join(root, 'scripts', 'validate-visual-evaluator.js'));

  let main = fs.readFileSync(mainPath, 'utf8');
  if (!main.includes('NEXA_VISUAL_EVALUATOR_BUILD_106')) {
    // The core patch expects Build 105 project markers. Runtime/app.asar patching creates them when needed.
    const core = path.join(here, 'Install-Nexa-Build-106-Core.js');
    fs.copyFileSync(core, path.join(root, 'Install-Nexa-Build-106-Core.js'));
    run(process.execPath, ['Install-Nexa-Build-106-Core.js']);
    main = fs.readFileSync(mainPath, 'utf8');
  }

  // Build 106.2: remove wording that commonly pushes SDXL toward character sheets.
  main = replaceIfPresent(
    main,
    "illustration: 'professional animated illustration and character concept art',",
    "illustration: 'professional animated illustration, polished single-scene character artwork',"
  );
  main = replaceIfPresent(
    main,
    "illustration: 'professional animated character illustration, polished concept art, clean expressive linework, coherent anatomy, dynamic silhouette, detailed cel shading, crisp edges, expressive face, controlled vibrant color palette, high detail',",
    "illustration: 'professional animated character illustration, polished single-scene artwork, clean expressive linework, coherent anatomy, dynamic silhouette, detailed cel shading, crisp edges, expressive face, controlled vibrant color palette, high detail',"
  );

  if (main.includes("const APP_BUILD = 106;")) main = main.replace("const APP_BUILD = 106;", "const APP_BUILD = '106.2';");
  if (!main.includes('NEXA_VISUAL_EVALUATOR_BUILD_106_2')) {
    const marker = '// NEXA_VISUAL_EVALUATOR_BUILD_106';
    if (main.includes(marker)) main = main.replace(marker, marker + '\n// NEXA_VISUAL_EVALUATOR_BUILD_106_2');
    else main = '// NEXA_VISUAL_EVALUATOR_BUILD_106_2\n' + main;
  }
  fs.writeFileSync(mainPath, main, 'utf8');

  // Re-copy evaluator because the core installer may have copied an older bundled file in some layouts.
  fs.copyFileSync(path.join(here, 'lib', 'visual-evaluator.js'), path.join(root, 'lib', 'visual-evaluator.js'));

  run(process.execPath, ['--check','main.js']);
  run(process.execPath, ['--check','preload.js']);
  run(process.execPath, ['--check','src/app.js']);
  run(process.execPath, ['scripts/validate-visual-evaluator.js']);

  const finalMain = fs.readFileSync(mainPath, 'utf8');
  if (!finalMain.includes('NEXA_VISUAL_EVALUATOR_BUILD_106') || !finalMain.includes('evaluateGeneratedImage')) {
    throw new Error('El evaluador visual no quedó enlazado en main.js.');
  }
  const finalUi = fs.readFileSync(path.join(root,'src','index.html'),'utf8');
  if (!finalUi.includes('Nexa Visual Evaluator v1')) throw new Error('La UI del evaluador no quedó instalada.');

  console.log('\n------------------------------------------------------------');
  console.log('Nexa AI v1.7.0 Build 106.2 — Visual Evaluator Runtime');
  console.log('INSTALADO Y VALIDADO');
  console.log('------------------------------------------------------------');
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
}
