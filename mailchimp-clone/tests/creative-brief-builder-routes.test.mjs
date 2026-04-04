import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreativeBriefBuilderDashboardRoutes, createCreativeBriefBuilderApiRoutes, createCreativeBriefBuilderOpsRoutes, createCreativeBriefBuilderPublicRoutes } from '../packages/creative-brief-builder/index.mjs';

test('creative-brief-builder routes honor custom base paths and stable ids', () => {
  const dashboard = createCreativeBriefBuilderDashboardRoutes('/labs/creative-brief-builder');
  const api = createCreativeBriefBuilderApiRoutes('/api/labs/creative-brief-builder');
  const ops = createCreativeBriefBuilderOpsRoutes('/ops/labs/creative-brief-builder');
  const pub = createCreativeBriefBuilderPublicRoutes('/public/labs/creative-brief-builder');
  assert.equal(dashboard[0].path, '/labs/creative-brief-builder');
  assert.equal(api[0].path, '/api/labs/creative-brief-builder/overview');
  assert.equal(ops[0].path, '/ops/labs/creative-brief-builder/health');
  assert.equal(pub[0].path, '/public/labs/creative-brief-builder');
  assert.match(dashboard[0].id, /creative\-brief\-builder/);
  assert.match(api[2].id, /creative\-brief\-builder/);
});

