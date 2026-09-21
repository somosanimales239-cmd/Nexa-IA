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
  assert.equal(packageJson.version, '1.3.1');
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

test('persistent chats and memory remain implemented outside the model', () => {
  assert.match(main, /nexa-data\.json/);
  assert.match(main, /upsertChat\(/);
  assert.match(main, /addMemory\(/);
  assert.match(main, /memoriesSystemPrompt\(/);
  assert.match(html, /data-testid="chat-list"/);
  assert.match(html, /data-testid="memory-list"/);
  assert.match(html, /data-testid="save-memory"/);
});

test('model-independent Knowledge Libraries are implemented', () => {
  assert.match(main, /class KnowledgeStore/);
  assert.match(main, /NexaAI\\\\Knowledge/);
  assert.match(main, /knowledgeSystemPrompt\(/);
  assert.match(main, /pdfjs-dist/);
  assert.match(main, /mammoth/);
  assert.match(preload, /knowledge:/);
  assert.match(html, /data-testid="knowledge-panel"/);
  assert.match(html, /data-testid="create-library"/);
  assert.match(appJs, /refreshLibraries\(/);
  assert.match(appJs, /runKnowledgeSearch\(/);
});

test('knowledge retrieval is injected as source-grounded local context', () => {
  assert.match(main, /prioriza estas fuentes sobre conocimiento general del modelo/i);
  assert.match(main, /No inventes datos que la fuente no contenga/i);
  assert.match(main, /chat:context/);
  assert.match(appJs, /sourceChips\(/);
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
  assert.match(html, /VRAM NVIDIA/);
});

test('no cloud AI endpoint is hard-coded in application source', () => {
  const combined = `${main}\n${preload}\n${appJs}`;
  assert.doesNotMatch(combined, /api\.openai\.com|anthropic\.com|generativelanguage\.googleapis\.com/i);
});


test('chat scrolling and branded desktop icon are implemented', () => {
  const html = read('src/index.html');
  const css = read('src/app.css');
  const appJs = read('src/app.js');
  const mainJs = read('main.js');
  assert.match(html, /chatScrollShell/);
  assert.match(html, /chatScrollRail/);
  assert.match(html, /chatScrollThumb/);
  assert.match(html, /jumpToBottomBtn/);
  assert.match(css, /\.chat-scroll-shell/);
  assert.match(css, /\.chat-scroll-rail/);
  assert.match(css, /\.chat-scroll-thumb/);
  assert.match(css, /\.workspace\s*\{[^}]*min-height\s*:\s*0[^}]*overflow\s*:\s*hidden/s);
  assert.match(css, /\.jump-to-bottom/);
  assert.match(appJs, /scrollMessagesToBottom/);
  assert.match(appJs, /setScrollFromRailPointer/);
  assert.match(appJs, /beginScrollThumbDrag/);
  assert.match(appJs, /jumpToBottomBtn\.hidden\s*=\s*false/);
  assert.match(mainJs, /assets.*icon\.ico/s);
  assert.equal(packageJson.build.win.icon, 'assets/icon.ico');
});


test('renderer avoids regex literals that break the App Builder parser', () => {
  assert.doesNotMatch(appJs, /\.replace\(\//);
  assert.doesNotMatch(appJs, /\.split\(\//);
  assert.doesNotMatch(appJs, /\.match\(\//);
  assert.doesNotMatch(appJs, /\.test\(\//);
});


test('persistent SQLite knowledge database and structured objectives are implemented', () => {
  const dbModule = read('lib/persistent-knowledge.js');
  assert.match(dbModule, /nexa-knowledge\.db/);
  assert.match(dbModule, /knowledge_objectives/);
  assert.match(dbModule, /objective_topics/);
  assert.match(dbModule, /knowledge_entries/);
  assert.match(dbModule, /knowledge_sources/);
  assert.match(dbModule, /knowledge_entry_sources/);
  assert.match(dbModule, /research_runs/);
  assert.match(dbModule, /VERIFIED/);
  assert.match(dbModule, /MISSING/);
  assert.match(dbModule, /CONFLICTING/);
  assert.match(preload, /knowledgeDb:/);
  assert.match(html, /knowledgeDbStats/);
  assert.match(appJs, /Guardar en conocimiento/);
});

test('web research is opt-in controllable, source ranked, validated and persisted', () => {
  const webResearch = read('lib/web-research.js');
  assert.match(webResearch, /duckDuckGoSearch/);
  assert.match(webResearch, /duckDuckGoLiteSearch/);
  assert.match(webResearch, /bingRssSearch/);
  assert.match(webResearch, /bingHtmlSearch/);
  assert.match(webResearch, /sourceType/);
  assert.match(webResearch, /nhtsa\.gov/);
  assert.match(main, /internetResearchEnabled/);
  assert.match(main, /autoResearchOnMissing/);
  assert.match(main, /researchTopic/);
  assert.match(main, /ollamaResearchJson/);
  assert.match(main, /knowledgeDb\.saveKnowledge/);
  assert.match(appJs, /Completar faltantes/);
  assert.match(html, /Permitir investigación por Internet/);
});
