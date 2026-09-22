'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { PersistentKnowledgeDB } = require('../lib/persistent-knowledge');
const { BrowserBridge } = require('../lib/browser-bridge');

function assert(value, message) { if (!value) throw new Error(message); }

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-browser-bridge-'));
  const memories = [];
  const store = { addMemory(input) { const row = { id:'mem_' + (memories.length + 1), text:String(input.text || '') }; memories.push(row); return row; } };
  const db = new PersistentKnowledgeDB(root);
  const objective = db.createObjective({ type:'automotive', make:'Toyota', model:'Corolla', year:2000, engine_code:'1ZZ-FE', market:'US' });
  const bridge = new BrowserBridge({ dataDir:root, store, knowledgeDb:db, appVersion:'test', port:0 });
  try {
    await bridge.start();
    const status = bridge.status({ includeToken:true });
    assert(status.ok, 'bridge did not start');
    assert(status.port > 0, 'bridge did not resolve a port');
    assert(status.pairingToken.length > 20, 'pairing token missing');
    const base = status.baseUrl;
    const headers = { 'Content-Type':'application/json', Authorization:'Bearer ' + status.pairingToken };

    let response = await fetch(base + '/api/v1/health');
    let body = await response.json();
    assert(response.ok && body.ok && body.apiVersion === '1', 'health failed');

    response = await fetch(base + '/api/v1/auth/check', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer wrong' }, body:'{}' });
    assert(response.status === 401, 'bad token was not rejected');

    response = await fetch(base + '/api/v1/worker/heartbeat', { method:'POST', headers, body:'{}' });
    body = await response.json();
    assert(response.ok && body.ok, 'worker heartbeat failed');
    assert(bridge.status().extensionWorkerOnline === true, 'extension worker online state failed');

    response = await fetch(base + '/api/v1/objectives', { headers });
    body = await response.json();
    assert(response.ok && body.objectives.some(x => x.id === objective.id), 'objective listing failed');

    const capturePayload = {
      objectiveId:objective.id,
      captureType:'selection',
      title:'Toyota Corolla 2000 ignition reference',
      url:'https://example.com/corolla-2000',
      selectedText:'Toyota Corolla 2000 1ZZ-FE ignition coil inspection reference text.',
      topic:'Ignition Coil Inspection',
      metadata:{ lang:'en' },
    };
    response = await fetch(base + '/api/v1/captures', { method:'POST', headers, body:JSON.stringify(capturePayload) });
    body = await response.json();
    assert(response.ok && body.ok && body.capture?.id, 'capture was not persisted');
    assert(body.knowledgeEntry?.id, 'capture did not create persistent knowledge');
    assert(body.knowledgeEntry.verification_status === 'PARTIAL', 'browser capture must default to PARTIAL');

    response = await fetch(base + '/api/v1/captures', { method:'POST', headers, body:JSON.stringify(capturePayload) });
    body = await response.json();
    assert(body.duplicate === true, 'duplicate capture was not detected');

    response = await fetch(base + '/api/v1/captures?limit=10', { headers });
    body = await response.json();
    assert(body.captures.length === 1, 'capture list should contain one deduplicated capture');

    response = await fetch(base + '/api/v1/memory', { method:'POST', headers, body:JSON.stringify({ text:'Remember this browser note.' }) });
    body = await response.json();
    assert(response.ok && body.memory?.text.includes('browser note'), 'memory endpoint failed');
    assert(memories.length === 1, 'memory was not written to store');

    const queued = db.enqueueBrowserCommand('open_url', { url:'https://example.com' });
    response = await fetch(base + '/api/v1/commands/next', { headers });
    body = await response.json();
    assert(body.command?.id === queued.id && body.command.status === 'CLAIMED', 'future browser command channel failed');
    response = await fetch(base + '/api/v1/commands/result', { method:'POST', headers, body:JSON.stringify({ id:queued.id, ok:true, result:{ opened:true } }) });
    body = await response.json();
    assert(body.command?.status === 'DONE', 'browser command result failed');

    const stats = db.stats();
    assert(stats.browser_captures === 1, 'browser capture stats failed');
    assert(stats.active_entries >= 1, 'knowledge entry stats failed');

    const replacement = bridge.regenerateToken();
    assert(replacement.pairingToken !== status.pairingToken, 'token regeneration failed');
    console.log('Browser Bridge validation: PASS');
    console.log(JSON.stringify({ captures:stats.browser_captures, active_entries:stats.active_entries, apiVersion:status.apiVersion }, null, 2));
  } finally {
    await bridge.stop().catch(() => {});
    db.close();
    fs.rmSync(root, { recursive:true, force:true });
  }
})().catch(error => { console.error(error.stack || error); process.exit(1); });
