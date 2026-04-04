import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { enforceArchitecture } from '../../large-project-capability-stack/packages/architecture-enforcer/index.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

test('Program 7 architecture hardening: app/package split satisfies capability-stack enforcer', () => {
  const result = enforceArchitecture(ROOT);
  assert.equal(result.ok, true);
  assert.ok(result.scannedFiles >= 10);
});
