'use strict';
const fs = require('fs');
const path = require('path');

const files = [
  'README-V1.8.3.md',
  'V1.8.3-UPDATE.md',
  path.join('lib', 'status-system-v183.js'),
  path.join('lib', 'no-timeout-visual-pipeline-v183.js'),
  path.join('scripts', 'validate-v183.js'),
];

for (const file of files) {
  const full = path.join(__dirname, '..', file);
  if (!fs.existsSync(full)) {
    console.error('Missing file:', file);
    process.exit(1);
  }
  const text = fs.readFileSync(full, 'utf8');
  if (text.includes('<<<<<<<') || text.includes('>>>>>>>')) {
    console.error('Conflict marker found in', file);
    process.exit(2);
  }
}

console.log('Nexa AI v1.8.3 validation: OK');
