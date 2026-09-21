'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const main = read('main.js');
const preload = read('preload.js');
const appJs = read('src/app.js');
const html = read('src/index.html');

test('Nexa AI package and Electron entry graph are valid', () => {
  assert.equal(packageJson.build.productName, 'Nexa AI');
  assert.equal(packageJson.version, '1.0.0');
  assert.ok(fs.existsSync(path.join(root, packageJson.main)));
  for (const file of ['preload.js','src/index.html','src/app.js','src/app.css']) assert.ok(fs.existsSync(path.join(root, file)), file);
});

test('Electron security stays isolated', () => {
  assert.match(main, /contextIsolation\s*:\s*true/);
  assert.match(main, /nodeIntegration\s*:\s*false/);
  assert.match(main, /sandbox\s*:\s*true/);
  assert.doesNotMatch(main, /webSecurity\s*:\s*false/);
  assert.doesNotMatch(preload, /exposeInMainWorld\([^)]*ipcRenderer/);
});

test('local Ollama engine integration is present and local by default', () => {
  assert.match(main, /127\.0\.0\.1:11434/);
  assert.match(main, /OLLAMA_MODELS/);
  assert.match(main, /\/api\/chat/);
  assert.match(main, /\/api\/tags/);
  assert.match(main, /\/api\/ps/);
  assert.match(main, /gpt-oss:20b/);
});

test('fast and light GPU profiles are real execution options', () => {
  assert.match(main, /profile:\s*'fast'/);
  assert.match(main, /lightGpuLayers:\s*6/);
  assert.match(main, /options\.num_gpu/);
  assert.match(appJs, /selectMode\('fast'/);
  assert.match(appJs, /selectMode\('light'/);
  assert.match(html, /data-testid="mode-fast"/);
  assert.match(html, /data-testid="mode-light"/);
});

test('persistent chats and memory are implemented', () => {
  assert.match(main, /nexa-data\.json/);
  assert.match(main, /upsertChat\(/);
  assert.match(main, /addMemory\(/);
  assert.match(main, /memoriesSystemPrompt\(/);
  assert.match(html, /data-testid="chat-list"/);
  assert.match(html, /data-testid="memory-list"/);
  assert.match(html, /data-testid="save-memory"/);
});

test('chat UI has real controls and stop support', () => {
  for (const id of ['new-chat','prompt-input','send-message','stop-generation','start-engine','warm-model','unload-model']) {
    assert.match(html, new RegExp(`data-testid="${id}"`));
  }
  assert.match(appJs, /sendMessage\(/);
  assert.match(appJs, /stopGeneration\(/);
  assert.match(appJs, /onToken/);
  assert.match(appJs, /onDone/);
});

test('hardware monitor and Unity detection are wired', () => {
  assert.match(main, /nvidia-smi/);
  assert.match(main, /Get-Process/);
  assert.match(main, /unityDetected/);
  assert.match(appJs, /maybeAutoUnity/);
  assert.match(html, /VRAM GTX 1070 Ti/);
});

test('no cloud AI endpoint is hard-coded in application source', () => {
  const combined = `${main}\n${preload}\n${appJs}`;
  assert.doesNotMatch(combined, /api\.openai\.com|anthropic\.com|generativelanguage\.googleapis\.com/i);
});
