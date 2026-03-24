import fs from 'node:fs';
import path from 'node:path';

import { BACKUPS_DIR, STATE_DIR } from '../src/config.mjs';

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

const args = new Set(process.argv.slice(2));
const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const backupArg = positional[0] || process.env.PMHNP_RESTORE_FROM;
const force = args.has('--force');
const sourceRoot = backupArg
  ? (path.isAbsolute(backupArg) ? backupArg : path.join(process.env.PMHNP_BACKUPS_DIR || BACKUPS_DIR, backupArg))
  : null;
const sourceStateDir = sourceRoot ? path.join(sourceRoot, 'state') : null;
const destinationDir = process.env.PMHNP_STATE_DIR || STATE_DIR;
const backupRoot = process.env.PMHNP_BACKUPS_DIR || BACKUPS_DIR;

if (!sourceRoot) {
  console.error('Usage: node scripts/restore-state.mjs <backup-directory> [--force]');
  process.exit(1);
}

if (!fs.existsSync(sourceStateDir)) {
  console.error(`Backup state directory not found: ${sourceStateDir}`);
  process.exit(1);
}

if (fs.existsSync(destinationDir) && !force) {
  console.error(`Destination already exists: ${destinationDir}. Re-run with --force to replace it safely.`);
  process.exit(1);
}

let safetyBackup = null;
if (fs.existsSync(destinationDir)) {
  safetyBackup = path.join(backupRoot, `pre-restore-${timestamp()}`);
  fs.mkdirSync(safetyBackup, { recursive: true });
  fs.cpSync(destinationDir, path.join(safetyBackup, 'state'), { recursive: true });
  fs.rmSync(destinationDir, { recursive: true, force: true });
}

fs.mkdirSync(path.dirname(destinationDir), { recursive: true });
fs.cpSync(sourceStateDir, destinationDir, { recursive: true });

console.log(JSON.stringify({
  ok: true,
  restored_from: sourceRoot,
  destination_dir: destinationDir,
  safety_backup: safetyBackup
}, null, 2));
