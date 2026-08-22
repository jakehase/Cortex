import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('detached adaptive-math continuation supervisor preserves execution and truth boundaries', () => {
  const result = spawnSync('python3', ['-m', 'unittest', 'scripts/test_continue_adaptive_math.py'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /Ran 7 tests/);
  assert.match(result.stderr, /OK/);

  const launcherPath = path.join(root, 'scripts/launch-adaptive-math-continuation.sh');
  const syntax = spawnSync('/bin/bash', ['-n', launcherPath], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  const launcher = fs.readFileSync(launcherPath, 'utf8');
  assert.match(launcher, /Restart=on-failure/);
  assert.match(launcher, /detached_job_notifier\.py/);
  assert.match(launcher, /sequential detached Hetzner Codex workers/);
  assert.match(launcher, /--dry-run/);
});
