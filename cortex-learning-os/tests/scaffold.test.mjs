import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CLOS_ROOT, artifactPath, safeRelativePath } from '../src/paths.mjs';
import { sha256Text } from '../src/hash.mjs';
import { readJson, writeJson } from '../src/json.mjs';

test('Cortex Learning OS scaffold paths are rooted and safe', () => {
  assert.equal(path.basename(CLOS_ROOT), 'cortex-learning-os');
  assert.equal(safeRelativePath('capsules/math-foundations/capsule.json'), 'capsules/math-foundations/capsule.json');
  assert.throws(() => safeRelativePath('../escape.json'), /unsafe relative path/);
  assert.equal(artifactPath('stage-a-smoke', 'run.json'), path.join(CLOS_ROOT, 'artifacts/stage-a-smoke/run.json'));
});

test('Cortex Learning OS JSON and hash helpers work deterministically', () => {
  const filePath = artifactPath('stage-a-scaffold-test', 'sample.json');
  writeJson(filePath, { ok: true, value: 'learning-os' });
  assert.deepEqual(readJson(filePath), { ok: true, value: 'learning-os' });
  assert.equal(sha256Text('learning-os').length, 64);
});

test('fixture validation helper validates Learning Capsule v0 records without overclaiming expertise', () => {
  const run = spawnSync(process.execPath, ['src/validate-fixtures.mjs'], { cwd: CLOS_ROOT, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.match(payload.truthBoundary, /does not prove domain expertise/);
});
