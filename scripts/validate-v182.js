'use strict';
const fs = require('fs');
const path = require('path');

const files = [
  'V1.8.2-UPDATE.md',
  path.join('lib', 'timeout-policy-v182.js'),
  path.join('lib', 'visual-review-v182.js'),
  path.join('scripts', 'validate-v182.js'),
];

const missing = files.filter((file) => !fs.existsSync(path.join(__dirname, '..', file)));
if (missing.length) {
  console.error('Missing files:', missing.join(', '));
  process.exit(1);
}

for (const file of files) {
  const content = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  if (content.includes('<<<<<<<') || content.includes('>>>>>>>')) {
    console.error('Conflict marker found in', file);
    process.exit(2);
  }
}

console.log('Nexa AI v1.8.2 validation: OK');
