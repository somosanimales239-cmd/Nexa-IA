'use strict';
const fs = require('fs');
const path = require('path');

const required = [
  'README-V1.9.0.md',
  'V1.9.0-UPDATE.md',
  path.join('lib', 'chat-attachment-intake-v190.js'),
  path.join('lib', 'chat-vision-router-v190.js'),
  path.join('lib', 'reference-sync-v190.js'),
  path.join('src', 'chat-attachments-v190.js'),
  path.join('src', 'chat-attachments-v190.css'),
  path.join('scripts', 'validate-v190.js'),
];

for (const rel of required) {
  const full = path.join(__dirname, '..', rel);
  if (!fs.existsSync(full)) {
    console.error('Missing file:', rel);
    process.exit(1);
  }
  const content = fs.readFileSync(full, 'utf8');
  if (content.includes('<<<<<<<') || content.includes('>>>>>>>')) {
    console.error('Conflict marker found:', rel);
    process.exit(2);
  }
}

console.log('Nexa AI v1.9.0 validation: OK');
