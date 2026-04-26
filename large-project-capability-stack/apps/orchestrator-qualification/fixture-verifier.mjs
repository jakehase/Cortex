import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function usage() {
  console.error('usage: node fixture-verifier.mjs <lint|tests|smoke> <workspacePath> <moduleId>');
  process.exit(1);
}

const [mode, workspacePath, moduleId] = process.argv.slice(2);
if (!mode || !workspacePath || !moduleId) usage();

const moduleRoot = path.join(workspacePath, 'modules', moduleId);
const manifestPath = path.join(moduleRoot, 'manifest.json');
const sourcePath = path.join(moduleRoot, 'source.mjs');
const testPath = path.join(moduleRoot, 'test.mjs');
const smokePath = path.join(moduleRoot, 'smoke.mjs');

if (!fs.existsSync(manifestPath)) {
  console.error(`missing fixture manifest for ${moduleId}`);
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
let command = [];

switch (mode) {
  case 'lint':
    command = [process.execPath, '--check', sourcePath];
    break;
  case 'tests':
    command = [process.execPath, testPath];
    break;
  case 'smoke':
    command = [process.execPath, smokePath];
    break;
  default:
    usage();
}

const [bin, ...args] = command;
const startedAt = Date.now();
try {
  const stdout = execFileSync(bin, args, { cwd: moduleRoot, encoding: 'utf8', stdio: 'pipe' });
  console.log(JSON.stringify({
    ok: true,
    verifier: mode,
    moduleId,
    command: [bin, ...args].join(' '),
    durationMs: Date.now() - startedAt,
    manifest,
    stdout: String(stdout || '').trim()
  }));
} catch (error) {
  const stdout = `${error.stdout || ''}`.trim();
  const stderr = `${error.stderr || ''}${error.message || ''}`.trim();
  console.log(JSON.stringify({
    ok: false,
    verifier: mode,
    moduleId,
    command: [bin, ...args].join(' '),
    durationMs: Date.now() - startedAt,
    manifest,
    stdout,
    stderr
  }));
  process.exit(3);
}
