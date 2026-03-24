import fs from 'node:fs';
import path from 'node:path';

import { BACKUPS_DIR, STATE_DIR } from '../src/config.mjs';

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function walkFiles(rootDir, currentDir = rootDir, files = []) {
  if (!fs.existsSync(currentDir)) return files;
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(rootDir, fullPath, files);
    } else if (entry.isFile()) {
      const stat = fs.statSync(fullPath);
      files.push({
        path: path.relative(rootDir, fullPath),
        size: stat.size,
        mtime: stat.mtime.toISOString()
      });
    }
  }
  return files;
}

const sourceDir = process.env.PMHNP_STATE_DIR || STATE_DIR;
const backupRoot = process.env.PMHNP_BACKUPS_DIR || BACKUPS_DIR;
const backupId = `state-backup-${timestamp()}`;
const destinationDir = path.join(backupRoot, backupId);
const destinationStateDir = path.join(destinationDir, 'state');

if (!fs.existsSync(sourceDir)) {
  console.error(`State directory does not exist: ${sourceDir}`);
  process.exit(1);
}

fs.mkdirSync(destinationDir, { recursive: true });
fs.cpSync(sourceDir, destinationStateDir, { recursive: true });

const files = walkFiles(destinationStateDir);
const manifest = {
  backup_id: backupId,
  created_at: new Date().toISOString(),
  source_dir: sourceDir,
  destination_dir: destinationDir,
  file_count: files.length,
  files
};

fs.writeFileSync(path.join(destinationDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, backup_id: backupId, destination_dir: destinationDir, file_count: files.length }, null, 2));
