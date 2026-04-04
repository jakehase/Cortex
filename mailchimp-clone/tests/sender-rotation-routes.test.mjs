import test from 'node:test';
import assert from 'node:assert/strict';
import { createSenderRotationDashboardRoutes, createSenderRotationApiRoutes, createSenderRotationOpsRoutes, createSenderRotationPublicRoutes } from '../packages/sender-rotation/index.mjs';

test('sender-rotation routes honor custom base paths and stable ids', () => {
  const dashboard = createSenderRotationDashboardRoutes('/labs/sender-rotation');
  const api = createSenderRotationApiRoutes('/api/labs/sender-rotation');
  const ops = createSenderRotationOpsRoutes('/ops/labs/sender-rotation');
  const pub = createSenderRotationPublicRoutes('/public/labs/sender-rotation');
  assert.equal(dashboard[0].path, '/labs/sender-rotation');
  assert.equal(api[0].path, '/api/labs/sender-rotation/overview');
  assert.equal(ops[0].path, '/ops/labs/sender-rotation/health');
  assert.equal(pub[0].path, '/public/labs/sender-rotation');
  assert.match(dashboard[0].id, /sender\-rotation/);
  assert.match(api[2].id, /sender\-rotation/);
});

