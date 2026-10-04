'use strict';
const assert=require('assert');
const fs=require('fs'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'..','lib','hosted-web-agent-v200.js'),'utf8');
for(const token of [
  'markerForToken','api/agent/next.php','api/agent/complete.php','forge.generate','chat.start','nexa.dashboard',
  'store.memory.save','knowledge.search','sdapi/v1/txt2img','sdapi/v1/extra-single-image','chat-attachments:stage',
  'http://127.0.0.1:7860','X-Nexa-Agent-Token'
]) assert(source.includes(token),token);
assert(source.includes("'\\u2063\\u2063'"));
assert(source.includes("'\\u2064\\u2064'"));
const main=fs.readFileSync(path.join(__dirname,'..','main-v200.js'),'utf8');
assert(main.includes("require('./main-v198.js')"));
assert(main.includes('capturedHandlers'));
console.log('Nexa AI v2.0.0 Hosted Web Agent tests: OK');
