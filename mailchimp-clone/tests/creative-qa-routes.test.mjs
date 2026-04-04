import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreativeQaDashboardRoutes, createCreativeQaApiRoutes, createCreativeQaOpsRoutes, createCreativeQaPublicRoutes } from '../packages/creative-qa/index.mjs';

test('creative-qa routes honor custom base paths and stable ids', () => {
  const dashboard = createCreativeQaDashboardRoutes('/labs/creative-qa');
  const api = createCreativeQaApiRoutes('/api/labs/creative-qa');
  const ops = createCreativeQaOpsRoutes('/ops/labs/creative-qa');
  const pub = createCreativeQaPublicRoutes('/public/labs/creative-qa');
  assert.equal(dashboard[0].path, '/labs/creative-qa');
  assert.equal(api[0].path, '/api/labs/creative-qa/overview');
  assert.equal(ops[0].path, '/ops/labs/creative-qa/health');
  assert.equal(pub[0].path, '/public/labs/creative-qa');
  assert.match(dashboard[0].id, /creative\-qa/);
  assert.match(api[2].id, /creative\-qa/);
});

