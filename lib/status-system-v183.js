'use strict';

const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function createStatusStore(baseDir, requestId) {
  const dataDir = baseDir || path.join('D:', 'LocalAI', 'NexaAI', 'Data');
  ensureDir(dataDir);
  const file = path.join(dataDir, 'visual-status-v183.json');

  const state = {
    requestId,
    attempt: 0,
    phase: 'QUEUED',
    status: 'WAITING',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    message: 'Trabajo visual en cola',
    qwenCalled: false,
    qwenReviewed: false,
    score: null,
    accepted: false,
    errors: [],
    history: [],
  };

  function write() {
    state.updatedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
  }

  function set(update = {}) {
    Object.assign(state, update || {});
    state.history.push({
      at: new Date().toISOString(),
      phase: state.phase,
      status: state.status,
      message: state.message,
      attempt: state.attempt,
    });
    if (state.history.length > 200) state.history = state.history.slice(-200);
    write();
    return snapshot();
  }

  function heartbeat(message) {
    if (message) state.message = message;
    return set({});
  }

  function snapshot() {
    return JSON.parse(JSON.stringify(state));
  }

  write();
  return { file, set, heartbeat, snapshot };
}

module.exports = { createStatusStore };
