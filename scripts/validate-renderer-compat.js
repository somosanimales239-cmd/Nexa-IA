'use strict';
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'src', 'app.js');
const source = fs.readFileSync(file, 'utf8');
const forbidden = [
  { text: '.replace(/', label: 'regular-expression literal in replace()' },
  { text: '.split(/', label: 'regular-expression literal in split()' },
  { text: '.match(/', label: 'regular-expression literal in match()' },
  { text: '.test(/', label: 'regular-expression literal in test()' }
];
for (const item of forbidden) {
  if (source.includes(item.text)) {
    console.error(`Renderer compatibility check failed: ${item.label} found in src/app.js`);
    process.exit(1);
  }
}
console.log('Renderer compatibility check passed: src/app.js contains no disallowed regex literal patterns.');
