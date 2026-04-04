import test from 'node:test';
import assert from 'node:assert/strict';
import { createBenchmarkStudioDashboardRoutes, createBenchmarkStudioApiRoutes, createBenchmarkStudioOpsRoutes, createBenchmarkStudioPublicRoutes } from '../packages/benchmark-studio/index.mjs';

test('benchmark-studio routes honor custom base paths and stable ids', () => {
  const dashboard = createBenchmarkStudioDashboardRoutes('/labs/benchmark-studio');
  const api = createBenchmarkStudioApiRoutes('/api/labs/benchmark-studio');
  const ops = createBenchmarkStudioOpsRoutes('/ops/labs/benchmark-studio');
  const pub = createBenchmarkStudioPublicRoutes('/public/labs/benchmark-studio');
  assert.equal(dashboard[0].path, '/labs/benchmark-studio');
  assert.equal(api[0].path, '/api/labs/benchmark-studio/overview');
  assert.equal(ops[0].path, '/ops/labs/benchmark-studio/health');
  assert.equal(pub[0].path, '/public/labs/benchmark-studio');
  assert.match(dashboard[0].id, /benchmark\-studio/);
  assert.match(api[2].id, /benchmark\-studio/);
});

