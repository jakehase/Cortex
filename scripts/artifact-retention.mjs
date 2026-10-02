#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REPORT_SCHEMA = 'clawd.artifact_retention_report.v2';
const RECEIPT_SCHEMA = 'clawd.artifact_backup_receipt.v1';
const MANIFEST_SCHEMA = 'clawd.artifact_backup_manifest.v1';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function argumentValue(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (index + 1 >= args.length || args[index + 1].startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return args[index + 1];
}

function canonicalRealpath(value, kind = 'path') {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error(`${kind} must be an absolute path`);
  }
  return fs.realpathSync(value);
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function directChildForTarget(root, target) {
  if (!isWithin(root, target) || root === target) return null;
  const first = path.relative(root, target).split(path.sep)[0];
  if (!first || first === '..') return null;
  const candidate = path.join(root, first);
  try {
    return fs.statSync(candidate).isDirectory() ? fs.realpathSync(candidate) : null;
  } catch {
    return null;
  }
}

function possiblePointerTargets(value, pointerPath, roots) {
  if (typeof value !== 'string' || !value.trim()) return [];
  const text = value.trim();
  const candidates = [];
  if (path.isAbsolute(text)) {
    candidates.push(text);
  } else if (text.includes('/') || text.startsWith('.')) {
    candidates.push(path.resolve(path.dirname(pointerPath), text));
    for (const root of roots) candidates.push(path.resolve(path.dirname(root), text));
  }
  const resolved = [];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) resolved.push(fs.realpathSync(candidate));
    } catch {
      // A broken or racing pointer does not create an unprotected target.
    }
  }
  return resolved;
}

function jsonStrings(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => jsonStrings(item, output));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => jsonStrings(item, output));
  return output;
}

function discoverPointerFiles(roots, policy) {
  const expression = new RegExp(
    String(policy.protectedPointerNamePattern || '(?:^latest(?:[-_.].*)?\\.json$|.*_latest\\.json$|^latest$)'),
    'i',
  );
  const maximumDepth = Number(policy.pointerScanMaxDepth ?? 6);
  const maximumEntries = Number(policy.pointerScanMaxEntries ?? 500_000);
  const maximumPointerBytes = Number(policy.maximumPointerBytes ?? 1_048_576);
  if (!Number.isInteger(maximumDepth) || maximumDepth < 1 || maximumDepth > 32) {
    throw new Error('pointerScanMaxDepth must be an integer between 1 and 32');
  }
  if (!Number.isInteger(maximumEntries) || maximumEntries < 1) {
    throw new Error('pointerScanMaxEntries must be a positive integer');
  }
  const pointers = new Set();
  let entries = 0;
  function visit(directory, depth) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      entries += 1;
      if (entries > maximumEntries) throw new Error('pointer scan entry bound exceeded');
      const target = path.join(directory, entry.name);
      if (expression.test(entry.name) && (entry.isFile() || entry.isSymbolicLink())) pointers.add(target);
      if (entry.isDirectory() && depth < maximumDepth) visit(target, depth + 1);
    }
  }
  for (const root of roots) visit(root, 1);
  for (const configured of policy.pointerFiles || []) {
    if (typeof configured !== 'string' || !path.isAbsolute(configured)) {
      throw new Error('every configured pointer file must be absolute');
    }
    if (fs.existsSync(configured) || fs.lstatSync(path.dirname(configured)).isDirectory()) pointers.add(configured);
  }
  return { pointers: [...pointers], maximumPointerBytes };
}

function protectedTargets(roots, policy) {
  const { pointers, maximumPointerBytes } = discoverPointerFiles(roots, policy);
  const protectedSet = new Set();
  const inspected = [];
  for (const pointerPath of pointers) {
    if (!fs.existsSync(pointerPath) && !fs.lstatSync(path.dirname(pointerPath)).isDirectory()) continue;
    let pointerRealpath = null;
    try { pointerRealpath = fs.realpathSync(pointerPath); } catch { /* broken pointers stay fail-safe below */ }
    for (const root of roots) {
      const containingCandidate = directChildForTarget(root, path.resolve(pointerPath));
      if (containingCandidate) protectedSet.add(containingCandidate);
      if (pointerRealpath) {
        const linkedCandidate = directChildForTarget(root, pointerRealpath);
        if (linkedCandidate) protectedSet.add(linkedCandidate);
      }
    }
    const record = { path: path.resolve(pointerPath), parsed: false, targetCount: 0 };
    try {
      const stats = fs.statSync(pointerPath);
      if (!stats.isFile() || stats.size > maximumPointerBytes) {
        record.reason = stats.size > maximumPointerBytes ? 'pointer_too_large' : 'pointer_not_regular_file';
      } else {
        const parsed = JSON.parse(fs.readFileSync(pointerPath, 'utf8'));
        record.parsed = true;
        for (const text of jsonStrings(parsed)) {
          for (const target of possiblePointerTargets(text, pointerPath, roots)) {
            for (const root of roots) {
              const candidate = directChildForTarget(root, target);
              if (candidate) {
                protectedSet.add(candidate);
                record.targetCount += 1;
              }
            }
          }
        }
      }
    } catch (error) {
      record.reason = `unreadable_or_invalid:${error?.code || error?.name || 'error'}`;
    }
    inspected.push(record);
  }
  return { protectedSet, inspected };
}

function containsProtectedFile(directory, protectedNames) {
  try { return fs.readdirSync(directory).some((name) => protectedNames.has(name)); }
  catch { return true; }
}

function treeSha256(root) {
  const hash = crypto.createHash('sha256');
  function visit(current, relative) {
    const stats = fs.lstatSync(current);
    const mode = stats.mode & 0o7777;
    if (stats.isSymbolicLink()) {
      hash.update(`L\0${relative}\0${mode}\0${fs.readlinkSync(current)}\0`);
      return;
    }
    if (stats.isFile()) {
      hash.update(`F\0${relative}\0${mode}\0${stats.size}\0`);
      hash.update(fs.readFileSync(current));
      hash.update('\0');
      return;
    }
    if (!stats.isDirectory()) throw new Error(`unsupported filesystem entry in candidate: ${relative}`);
    hash.update(`D\0${relative}\0${mode}\0`);
    for (const name of fs.readdirSync(current).sort()) {
      visit(path.join(current, name), relative ? `${relative}/${name}` : name);
    }
  }
  visit(root, '');
  return hash.digest('hex');
}

function loadBackupAuthority(policy, roots, candidates) {
  const receiptPath = canonicalRealpath(policy.backupReceiptPath, 'backupReceiptPath');
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  if (receipt.schemaVersion !== RECEIPT_SCHEMA) throw new Error('backup receipt schema is not accepted');
  const generatedAt = Date.parse(receipt.generatedAt || '');
  const validUntil = Date.parse(receipt.validUntil || '');
  if (!Number.isFinite(generatedAt) || !Number.isFinite(validUntil) || generatedAt > Date.now() || validUntil <= Date.now()) {
    throw new Error('backup receipt timestamps are invalid or expired');
  }
  const manifestPath = canonicalRealpath(receipt.manifestPath, 'backup manifest path');
  if (!SHA256_PATTERN.test(String(receipt.manifestSha256 || ''))) throw new Error('backup receipt manifest digest is invalid');
  if (sha256File(manifestPath) !== receipt.manifestSha256) throw new Error('backup manifest digest mismatch');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== MANIFEST_SCHEMA || !Array.isArray(manifest.entries)) {
    throw new Error('backup manifest schema is not accepted');
  }
  const entries = new Map();
  for (const entry of manifest.entries) {
    const source = canonicalRealpath(entry.sourceRealpath, 'backup sourceRealpath');
    const backup = canonicalRealpath(entry.backupPath, 'backupPath');
    if (!SHA256_PATTERN.test(String(entry.sourceTreeSha256 || ''))) throw new Error(`missing source tree digest for ${source}`);
    if (!SHA256_PATTERN.test(String(entry.backupSha256 || ''))) throw new Error(`missing backup digest for ${source}`);
    if (sha256File(backup) !== entry.backupSha256) throw new Error(`backup artifact digest mismatch for ${source}`);
    entries.set(source, { ...entry, sourceRealpath: source, backupPath: backup });
  }
  for (const candidate of candidates) {
    const entry = entries.get(candidate.realpath);
    if (!entry) throw new Error(`no backup manifest entry for candidate ${candidate.realpath}`);
    const observedTree = treeSha256(candidate.realpath);
    if (observedTree !== entry.sourceTreeSha256) throw new Error(`source tree digest differs from backup receipt for ${candidate.realpath}`);
    candidate.sourceTreeSha256 = observedTree;
  }
  return { receiptPath, manifestPath, manifestSha256: receipt.manifestSha256, entries };
}

function main() {
  const args = process.argv.slice(2);
  const policyPath = path.resolve(argumentValue(args, '--policy', 'config/artifact-retention/default.json'));
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  const retentionDays = Number(argumentValue(args, '--older-than-days', policy.defaultRetentionDays));
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    throw new Error('retentionDays must be positive and finite');
  }
  const requiredApplyFlags = Array.isArray(policy.applyRequires) ? policy.applyRequires : ['--apply', '--confirm-retention-delete'];
  const anyApplyFlag = args.includes('--apply') || args.includes('--confirm-retention-delete');
  const apply = requiredApplyFlags.every((flag) => args.includes(flag));
  if (anyApplyFlag && !apply) throw new Error('destructive retention requires every configured confirmation flag');
  const roots = [];
  for (const rootValue of policy.roots || []) {
    if (!fs.existsSync(rootValue)) continue;
    const root = canonicalRealpath(rootValue, 'retention root');
    if (!fs.statSync(root).isDirectory()) throw new Error(`retention root is not a directory: ${root}`);
    roots.push(root);
  }
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const protectedNames = new Set(policy.protectedBasenames || []);
  const pointerState = protectedTargets(roots, policy);
  const candidates = [];
  for (const root of roots) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || protectedNames.has(entry.name)) continue;
      const target = path.join(root, entry.name);
      const realpath = fs.realpathSync(target);
      if (path.dirname(realpath) !== root) continue;
      const stats = fs.statSync(realpath);
      if (stats.mtimeMs >= cutoff || containsProtectedFile(realpath, protectedNames)) continue;
      if (pointerState.protectedSet.has(realpath)) continue;
      candidates.push({
        path: target,
        realpath,
        modifiedAt: stats.mtime.toISOString(),
        mtimeMs: stats.mtimeMs,
        device: stats.dev,
        inode: stats.ino,
      });
    }
  }

  let backupAuthority = null;
  if (apply && candidates.length) backupAuthority = loadBackupAuthority(policy, roots, candidates);
  const deleted = [];
  if (apply) {
    for (const candidate of candidates) {
      const freshPointers = protectedTargets(roots, policy);
      if (freshPointers.protectedSet.has(candidate.realpath)) {
        throw new Error(`candidate became pointer-protected before deletion: ${candidate.realpath}`);
      }
      const stats = fs.statSync(candidate.realpath);
      if (
        stats.dev !== candidate.device
        || stats.ino !== candidate.inode
        || stats.mtimeMs !== candidate.mtimeMs
        || stats.mtimeMs >= cutoff
        || containsProtectedFile(candidate.realpath, protectedNames)
      ) {
        throw new Error(`candidate changed before deletion: ${candidate.realpath}`);
      }
      const entry = backupAuthority.entries.get(candidate.realpath);
      if (!entry || sha256File(entry.backupPath) !== entry.backupSha256) {
        throw new Error(`backup authority changed before deletion: ${candidate.realpath}`);
      }
      if (treeSha256(candidate.realpath) !== entry.sourceTreeSha256) {
        throw new Error(`candidate tree changed before deletion: ${candidate.realpath}`);
      }
      fs.rmSync(candidate.realpath, { recursive: true, force: false });
      deleted.push(candidate.realpath);
    }
  }

  const report = {
    schemaVersion: REPORT_SCHEMA,
    generatedAt: new Date().toISOString(),
    outcome: 'green',
    policyPath,
    retentionDays,
    mode: apply ? 'applied' : 'dry_run',
    rootCount: roots.length,
    pointerFilesInspected: pointerState.inspected.length,
    protectedPointerTargetCount: pointerState.protectedSet.size,
    backupReceiptValidated: Boolean(backupAuthority),
    candidateCount: candidates.length,
    candidates: candidates.map(({ mtimeMs, device, inode, sourceTreeSha256, ...candidate }) => ({
      ...candidate,
      sourceTreeSha256: sourceTreeSha256 || null,
    })),
    deletedCount: deleted.length,
    deleted,
    truthBoundary: apply
      ? 'Every deleted candidate was revalidated against current pointers, a current source-tree digest, and a hash-bound backup receipt immediately before deletion.'
      : 'No files were deleted. Destructive application fails closed without all confirmation flags and a current hash-bound candidate-specific backup receipt.',
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: REPORT_SCHEMA,
    generatedAt: new Date().toISOString(),
    outcome: 'blocked',
    error: `${error?.name || 'Error'}: ${error?.message || error}`,
    deletedCount: 0,
    truthBoundary: 'Retention failed closed. This error artifact does not assert that any candidate was deleted.',
  }, null, 2)}\n`);
  process.exitCode = 1;
}
