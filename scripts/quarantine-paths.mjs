#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const WORKSPACE = '/root/clawd';
const QUARANTINE_ROOT = path.join(WORKSPACE, '_quarantine');

function usage() {
  console.error('Usage: node scripts/quarantine-paths.mjs --label <name> [--reason <text>] [--from-file <file>] <path> [<path> ...]');
  process.exit(1);
}

function parseArgs(argv) {
  const args = { label: null, reason: '', fromFile: null, paths: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--label') {
      args.label = argv[++i] || null;
    } else if (token === '--reason') {
      args.reason = argv[++i] || '';
    } else if (token === '--from-file') {
      args.fromFile = argv[++i] || null;
    } else {
      args.paths.push(token);
    }
  }
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function sanitize(value) {
  return String(value || 'quarantine').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'quarantine';
}

const args = parseArgs(process.argv.slice(2));
if (args.fromFile) {
  const filePaths = fs.readFileSync(path.resolve(args.fromFile), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  args.paths.push(...filePaths);
}
if (!args.label || !args.paths.length) usage();

const stamp = new Date().toISOString().slice(0, 10);
const bucketName = `${stamp}-${sanitize(args.label)}`;
const bucketRoot = path.join(QUARANTINE_ROOT, bucketName);
ensureDir(bucketRoot);

const moved = [];
for (const rawPath of args.paths) {
  const source = path.resolve(rawPath);
  if (!source.startsWith(WORKSPACE)) {
    throw new Error(`Refusing to quarantine path outside workspace: ${source}`);
  }
  if (!exists(source)) continue;
  const rel = path.relative(WORKSPACE, source);
  const dest = path.join(bucketRoot, rel);
  ensureDir(path.dirname(dest));
  fs.renameSync(source, dest);
  moved.push({ source, rel, dest });
}

const manifest = {
  generatedAt: new Date().toISOString(),
  workspace: WORKSPACE,
  bucket: bucketName,
  reason: args.reason || null,
  moved: moved.map((entry) => ({
    relativePath: entry.rel,
    destination: path.relative(WORKSPACE, entry.dest)
  }))
};
fs.writeFileSync(path.join(bucketRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
