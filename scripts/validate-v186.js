'use strict';
const fs = require('fs');
const path = require('path');

const required = [
  'README-V1.8.6.md',
  'V1.8.6-UPDATE.md',
  'package.json',
  'nexa.project.json',
  'main-v186.js',
  path.join('lib', 'visual-review-v186.js'),
  path.join('lib', 'reference-consistency-v186.js'),
  path.join('src', 'reference-panel-v186.html'),
  path.join('src', 'reference-panel-v186.js'),
  path.join('scripts', 'validate-v186.js'),
];

for (const rel of required) {
  const full = path.join(__dirname, '..', rel);
  if (!fs.existsSync(full)) {
    console.error('Missing file:', rel);
    process.exit(1);
  }
  const text = fs.readFileSync(full, 'utf8');
  if (text.includes('<<<<<<<') || text.includes('>>>>>>>')) {
    console.error('Conflict marker found:', rel);
    process.exit(2);
  }
}

console.log('Nexa AI v1.8.6 validation: OK');
