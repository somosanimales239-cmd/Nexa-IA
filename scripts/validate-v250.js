'use strict';

// Nexa AI v2.5.0 compatibility validator.
// IMPORTANT: this validator is intentionally forward-compatible.
// Newer Developer Runtime releases must preserve the v2.5.0 contract,
// but they are not required to keep the active agent pinned to v250.

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function must(condition, message) {
  if (!condition) throw new Error(message);
}

function parseVersion(value) {
  const parts = String(value || '0.0.0').split('.');
  return {
    major: Number(parts[0] || 0),
    minor: Number(parts[1] || 0),
    patch: Number(String(parts[2] || '0').split('-')[0].split('+')[0] || 0),
  };
}

function atLeast250(value) {
  const v = parseVersion(value);
  if (v.major > 2) return true;
  if (v.major < 2) return false;
  if (v.minor > 5) return true;
  if (v.minor < 5) return false;
  return v.patch >= 0;
}

const required = [
  'lib/developer-runtime-v250.js',
  'lib/hosted-web-agent-v203.js',
  'package.json',
  'nexa.project.json',
  'main-v203.js',
];

for (const rel of required) {
  const full = path.join(root, rel);
  must(fs.existsSync(full), 'Missing v2.5.0 compatibility dependency: ' + rel);
  const source = fs.readFileSync(full, 'utf8');
  must(!source.includes('<<<<<<<') && !source.includes('>>>>>>>'), 'Conflict marker: ' + rel);
}

// Preserve the original v2.5.0 runtime contract even when a newer runtime is active.
const runtime = read('lib/developer-runtime-v250.js');
for (const token of [
  'class DeveloperRuntime',
  'shell:false',
  'allowedRoots',
  'semanticIndex(payload',
  'semanticSearch(payload',
  'browserRun(payload',
  'contextIsolation:true',
  'nodeIntegration:false',
  'sandbox:true',
  'workflowRun(payload',
  'jobResume(payload',
  'securityScan(payload',
  'realPathSafe',
  'symlink/junction',
  'safeChildEnv',
  'redactSecrets',
  'isSensitiveFile',
  'sanitizeForStorage',
  'Terminal bloqueó ejecución inline',
  "require('node:sqlite')",
  'migrationsEnabled:false',
  'networkEnabled:false',
  'deploy:{enabled:false}',
]) {
  must(runtime.includes(token), 'Developer Runtime v250 compatibility token missing: ' + token);
}

const pkg = JSON.parse(read('package.json'));
must(atLeast250(pkg.version), 'Package version predates Developer Runtime v2.5.0: ' + pkg.version);
must(pkg.main === 'main-v203.js', 'main entry must remain main-v203.js');
for (const key of ['validate:v250', 'test:v250', 'validate:v203', 'test:v203']) {
  must(Boolean(pkg.scripts && pkg.scripts[key]), 'Missing package script ' + key);
}
must(Array.isArray(pkg.build && pkg.build.files) && pkg.build.files.includes('lib/**/*'), 'electron-builder must package lib/**/*');

// The active Hosted Web Agent may load v250 or any newer compatible runtime.
const agent = read('lib/hosted-web-agent-v203.js');
const runtimeRequire = new RegExp("require\\(['\"]\\.\\/developer-runtime-v([0-9]+)['\"]\\)");
const runtimeMatch = agent.match(runtimeRequire);
must(runtimeMatch, 'Hosted agent does not load a versioned Developer Runtime.');
const activeRuntimeNumber = Number(runtimeMatch[1] || 0);
must(activeRuntimeNumber >= 250, 'Hosted agent Developer Runtime predates v250: v' + activeRuntimeNumber);
const activeRuntimeFile = 'lib/developer-runtime-v' + activeRuntimeNumber + '.js';
must(fs.existsSync(path.join(root, activeRuntimeFile)), 'Hosted agent runtime file is missing: ' + activeRuntimeFile);

for (const token of [
  'this.developer=new DeveloperRuntime',
  "startsWith('developer.')",
  'runDeveloper(job)',
  'developerConfigPath',
  'developer:artifact',
  'developer:progress',
]) {
  must(agent.includes(token), 'Hosted agent missing preserved Developer v2.5.0 behavior: ' + token);
}

// The agent's advertised version must match the current package version, not a historical release.
const expectedVersionMarker = "const VERSION = '" + String(pkg.version) + "'";
must(agent.includes(expectedVersionMarker), 'Hosted agent version does not match package.json: expected ' + expectedVersionMarker);

const main = read('main-v203.js');
must(main.includes("require('./main-v198.js')"), 'main-v203 must preserve main-v198 chain');
must(main.includes("loadFile(path.join(__dirname, 'src', 'index.html'))"), 'App Builder BrowserWindow.loadFile detector must remain present');

const project = JSON.parse(read('nexa.project.json'));
const projectVersion = String(project.application_version || project.version || '');
must(projectVersion === String(pkg.version), 'nexa.project application version does not match package.json');
must(String(project.build || '') === String(pkg.version), 'nexa.project build does not match package.json');
for (const feature of [
  'developer-runtime-v250',
  'developer-controlled-terminal',
  'developer-electron-browser-agent',
  'developer-semantic-code-index',
  'developer-persistent-workflows',
]) {
  must(project.features && project.features.includes(feature), 'Missing preserved project feature ' + feature);
}

console.log('Nexa AI v2.5.0 Developer Runtime compatibility validation: OK (' + pkg.version + ', active runtime v' + activeRuntimeNumber + ')');
