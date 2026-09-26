'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const backupDir = path.join(root, '.nexa-build106-backup');
const manifestPath = path.join(backupDir, 'manifest.json');

if (!fs.existsSync(manifestPath)) {
  console.error('No encontré .nexa-build106-backup/manifest.json. No hay rollback Build 106 disponible.');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const rel of manifest.backedUp || []) {
  const source = path.join(backupDir, rel);
  const target = path.join(root, rel);
  if (!fs.existsSync(source)) continue;
  fs.mkdirSync(path.dirname(target), { recursive:true });
  fs.copyFileSync(source, target);
  console.log(`Restaurado: ${rel}`);
}
for (const rel of manifest.createdFiles || []) {
  const target = path.join(root, rel);
  if (fs.existsSync(target)) {
    fs.rmSync(target, { force:true });
    console.log(`Eliminado Build 106: ${rel}`);
  }
}
console.log('\nRollback completado. Nexa volvió a los archivos guardados antes de Build 106.');
