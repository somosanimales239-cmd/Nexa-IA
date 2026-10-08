'use strict';

// Nexa AI v2.5.1 compatibility validator.
// Forward-compatible by design: future Developer Runtime versions must preserve
// the v2.5.1 stabilization contract without forcing the active app to stay 2.5.1.

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function must(value, message) { if (!value) throw new Error(message); }
function parseVersion(value) {
  const parts = String(value || '0.0.0').split('.');
  return {
    major: Number(parts[0] || 0),
    minor: Number(parts[1] || 0),
    patch: Number(String(parts[2] || '0').split('-')[0].split('+')[0] || 0),
  };
}
function atLeast251(value) {
  const v = parseVersion(value);
  if (v.major > 2) return true;
  if (v.major < 2) return false;
  if (v.minor > 5) return true;
  if (v.minor < 5) return false;
  return v.patch >= 1;
}

for (const rel of [
  'lib/developer-runtime-v251.js',
  'lib/hosted-web-agent-v203.js',
  'package.json',
  'nexa.project.json',
]) {
  const full = path.join(root, rel);
  must(fs.existsSync(full), 'Missing v2.5.1 compatibility dependency: ' + rel);
  const source = fs.readFileSync(full, 'utf8');
  must(!source.includes('<<<<<<<') && !source.includes('>>>>>>>'), 'Conflict marker: ' + rel);
}

// Preserve the v2.5.1 stabilization runtime contract even when a newer runtime is active.
const runtime = read('lib/developer-runtime-v251.js');
for (const token of [
  "const VERSION = '2.5.1'",
  'commandAvailability()',
  'controlledSpawnSpec(command,args=[])',
  'runControlledProcess({cwd,command,args=[]',
  'Comando no instalado o no disponible en PATH',
  'commandAvailability:this.commandAvailability()',
  "available:!!resolveOnPath('git')",
]) {
  must(runtime.includes(token), 'Runtime v2.5.1 stabilization token missing: ' + token);
}

const pkg = JSON.parse(read('package.json'));
must(atLeast251(pkg.version), 'Package version predates Developer Runtime v2.5.1: ' + pkg.version);
must(pkg.main === 'main-v203.js', 'main entry must remain main-v203.js');
for (const key of ['validate:v251', 'test:v251', 'validate:v250', 'test:v250']) {
  must(Boolean(pkg.scripts && pkg.scripts[key]), 'Missing package script ' + key);
}

const agent = read('lib/hosted-web-agent-v203.js');
const runtimeRequire = new RegExp("require\\(['\"]\\.\\/developer-runtime-v([0-9]+)['\"]\\)");
const runtimeMatch = agent.match(runtimeRequire);
must(runtimeMatch, 'Hosted agent does not load a versioned Developer Runtime.');
const activeRuntimeNumber = Number(runtimeMatch[1] || 0);
must(activeRuntimeNumber >= 251, 'Hosted agent Developer Runtime predates v251: v' + activeRuntimeNumber);
const activeRuntimeFile = 'lib/developer-runtime-v' + activeRuntimeNumber + '.js';
must(fs.existsSync(path.join(root, activeRuntimeFile)), 'Hosted agent runtime file is missing: ' + activeRuntimeFile);
const expectedVersionMarker = "const VERSION = '" + String(pkg.version) + "'";
must(agent.includes(expectedVersionMarker), 'Hosted agent version does not match package.json: expected ' + expectedVersionMarker);

const project = JSON.parse(read('nexa.project.json'));
const projectVersion = String(project.application_version || project.version || '');
must(projectVersion === String(pkg.version), 'nexa.project application version does not match package.json');
must(String(project.build || '') === String(pkg.version), 'nexa.project build does not match package.json');
for (const feature of [
  'developer-runtime-v251',
  'developer-windows-cmd-wrapper-stabilization',
  'developer-command-availability',
  'developer-safe-internal-git-runner',
]) {
  must(project.features && project.features.includes(feature), 'Missing v2.5.1 project feature ' + feature);
}

console.log('Nexa AI v2.5.1 Developer Runtime compatibility validation: OK (' + pkg.version + ', active runtime v' + activeRuntimeNumber + ')');
