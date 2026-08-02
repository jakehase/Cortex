import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('parallel continuation supervisor is bounded, responsive, and acquisition-only', () => {
  const result = spawnSync('python3', ['-m', 'unittest', 'scripts/test_continue_parallel_adaptive_math.py'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /Ran 6 tests/);
  assert.match(result.stderr, /OK/);
});
