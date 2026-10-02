import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'artifact-retention.mjs');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
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
    hash.update(`D\0${relative}\0${mode}\0`);
    for (const name of fs.readdirSync(current).sort()) {
      visit(path.join(current, name), relative ? `${relative}/${name}` : name);
    }
  }
  visit(root, '');
  return hash.digest('hex');
}

function fixture(context) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-retention-test-'));
  context.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'artifacts');
  const promoted = path.join(root, 'promoted-old');
  const removable = path.join(root, 'removable-old');
  fs.mkdirSync(promoted, { recursive: true });
  fs.mkdirSync(removable, { recursive: true });
  fs.writeFileSync(path.join(promoted, 'data.txt'), 'promoted\n');
  fs.writeFileSync(path.join(removable, 'data.txt'), 'removable\n');
  const old = new Date(Date.now() - 10 * 86_400_000);
  fs.utimesSync(promoted, old, old);
  fs.utimesSync(removable, old, old);
  fs.writeFileSync(path.join(root, 'latest.json'), `${JSON.stringify({ artifactRoot: promoted })}\n`);
  const receipt = path.join(temporary, 'receipt.json');
  const policy = path.join(temporary, 'policy.json');
  fs.writeFileSync(policy, `${JSON.stringify({
    schemaVersion: 'clawd.artifact_retention_policy.v2',
    roots: [root],
    defaultRetentionDays: 1,
    protectedBasenames: ['latest', 'latest.json', 'manifest.json'],
    protectedPointerNamePattern: '(?:^latest(?:[-_.].*)?\\.json$|.*_latest\\.json$|^latest$)',
    pointerScanMaxDepth: 6,
    pointerScanMaxEntries: 1000,
    maximumPointerBytes: 1048576,
    pointerFiles: [path.join(root, 'latest.json')],
    applyRequires: ['--apply', '--confirm-retention-delete'],
    backupReceiptPath: receipt,
  }, null, 2)}\n`);
  return { temporary, root, promoted, removable, receipt, policy };
}

function run(fx, extra = []) {
  return spawnSync(process.execPath, [script, '--policy', fx.policy, ...extra], { encoding: 'utf8' });
}

function createBackupAuthority(fx, { validUntil = new Date(Date.now() + 3_600_000).toISOString() } = {}) {
  const backup = path.join(fx.temporary, 'removable-old.tar');
  fs.writeFileSync(backup, 'durable backup bytes\n');
  const manifest = path.join(fx.temporary, 'backup-manifest.json');
  fs.writeFileSync(manifest, `${JSON.stringify({
    schemaVersion: 'clawd.artifact_backup_manifest.v1',
    generatedAt: new Date().toISOString(),
    entries: [{
      sourceRealpath: fs.realpathSync(fx.removable),
      sourceTreeSha256: treeSha256(fx.removable),
      backupPath: backup,
      backupSha256: sha256File(backup),
    }],
  }, null, 2)}\n`);
  fs.writeFileSync(fx.receipt, `${JSON.stringify({
    schemaVersion: 'clawd.artifact_backup_receipt.v1',
    generatedAt: new Date(Date.now() - 1000).toISOString(),
    validUntil,
    manifestPath: manifest,
    manifestSha256: sha256File(manifest),
  }, null, 2)}\n`);
}

test('dry run resolves external pointer targets and never selects the promoted directory', (context) => {
  const fx = fixture(context);
  const result = run(fx);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.mode, 'dry_run');
  assert.equal(report.deletedCount, 0);
  assert.deepEqual(report.candidates.map((candidate) => candidate.realpath), [fs.realpathSync(fx.removable)]);
  assert.equal(report.protectedPointerTargetCount, 1);
  assert.equal(fs.existsSync(fx.promoted), true);
  assert.equal(fs.existsSync(fx.removable), true);
});

test('destructive mode fails closed without every flag or a current backup receipt', (context) => {
  const fx = fixture(context);
  const oneFlag = run(fx, ['--apply']);
  assert.equal(oneFlag.status, 1);
  assert.match(JSON.parse(oneFlag.stderr).error, /every configured confirmation flag/);
  const noReceipt = run(fx, ['--apply', '--confirm-retention-delete']);
  assert.equal(noReceipt.status, 1);
  assert.equal(JSON.parse(noReceipt.stderr).outcome, 'blocked');
  assert.equal(fs.existsSync(fx.promoted), true);
  assert.equal(fs.existsSync(fx.removable), true);
});

test('valid hash-bound candidate-specific backup authority permits only the unpromoted deletion', (context) => {
  const fx = fixture(context);
  createBackupAuthority(fx);
  const removableRealpath = fs.realpathSync(fx.removable);
  const result = run(fx, ['--apply', '--confirm-retention-delete']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.mode, 'applied');
  assert.equal(report.backupReceiptValidated, true);
  assert.deepEqual(report.deleted, [removableRealpath]);
  assert.equal(fs.existsSync(fx.removable), false);
  assert.equal(fs.existsSync(fx.promoted), true);
});

test('invalid age and expired backup receipts fail closed without deletion', (context) => {
  const fx = fixture(context);
  const invalidAge = run(fx, ['--older-than-days', '0']);
  assert.equal(invalidAge.status, 1);
  assert.match(JSON.parse(invalidAge.stderr).error, /positive and finite/);
  createBackupAuthority(fx, { validUntil: new Date(Date.now() - 1000).toISOString() });
  const expired = run(fx, ['--apply', '--confirm-retention-delete']);
  assert.equal(expired.status, 1);
  assert.match(JSON.parse(expired.stderr).error, /expired/);
  assert.equal(fs.existsSync(fx.promoted), true);
  assert.equal(fs.existsSync(fx.removable), true);
});
