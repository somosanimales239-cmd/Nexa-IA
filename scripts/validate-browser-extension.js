'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const root = path.join(process.cwd(), 'browser-extension');
function assert(v,m){ if(!v) throw new Error(m); }
const manifest = JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
assert(manifest.manifest_version === 3, 'Chrome extension must use Manifest V3');
assert(manifest.permissions.includes('storage'), 'storage permission missing');
assert(manifest.permissions.includes('scripting'), 'scripting permission missing');
assert(manifest.permissions.includes('alarms'), 'alarms permission missing for automatic worker');
assert(manifest.host_permissions.includes('http://127.0.0.1:32145/*'), 'loopback host permission missing');
for (const file of ['background.js','popup.js','options.js']) {
  cp.execFileSync(process.execPath, ['--check', path.join(root,file)], { stdio:'inherit' });
}
for (const file of ['popup.html','popup.css','options.html','options.css','README.txt','icons/icon32.png','icons/icon64.png','icons/icon128.png']) {
  assert(fs.existsSync(path.join(root,file)), 'Missing extension file: ' + file);
}
const background = fs.readFileSync(path.join(root,'background.js'),'utf8');
assert(background.includes('/api/v1/captures'), 'capture API not wired');
assert(background.includes('/api/v1/memory'), 'memory API not wired');
assert(background.includes('/api/v1/commands/next'), 'automatic browser command polling missing');
assert(background.includes('web_research'), 'web research command missing');
assert(background.includes('/api/v1/worker/heartbeat'), 'worker heartbeat missing');
assert(background.includes('Guardar selección en Nexa Knowledge'), 'context menu missing');
console.log('Chrome Browser Extension validation: PASS');
