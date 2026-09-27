'use strict';

const fs = require('fs');
const path = require('path');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const DOC_EXT = new Set(['.pdf', '.txt', '.md', '.docx']);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function classifyPath(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (DOC_EXT.has(ext)) return 'document';
  return 'other';
}

function sanitizeName(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function ingestFiles(files, baseDir) {
  const root = baseDir || path.join('D:', 'LocalAI', 'NexaAI', 'Data', 'chat-uploads');
  ensureDir(root);

  const ingested = [];
  for (const file of (files || [])) {
    const kind = classifyPath(file.path || file.name);
    const safe = `${Date.now()}-${Math.random().toString(36).slice(2,8)}-${sanitizeName(file.name || path.basename(file.path || 'upload.bin'))}`;
    const dest = path.join(root, safe);
    if (file.path && fs.existsSync(file.path)) {
      fs.copyFileSync(file.path, dest);
    } else if (file.buffer) {
      fs.writeFileSync(dest, file.buffer);
    } else {
      continue;
    }
    ingested.push({
      id: safe,
      name: file.name || path.basename(dest),
      path: dest,
      type: kind,
      size: fs.statSync(dest).size,
      createdAt: new Date().toISOString(),
    });
  }

  return ingested;
}

module.exports = {
  classifyPath,
  ingestFiles,
};
