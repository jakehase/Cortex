import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativeBriefBuilderSnapshot, createCreativeBriefBuilderDashboardRoutes, createCreativeBriefBuilderApiRoutes, createCreativeBriefBuilderOpsRoutes, createCreativeBriefBuilderPublicRoutes, summarizeCreativeBriefBuilderFixtures } from '../packages/creative-brief-builder/index.mjs';

test('creative-brief-builder package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildCreativeBriefBuilderSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCreativeBriefBuilderDashboardRoutes().length, 3);
  assert.equal(createCreativeBriefBuilderApiRoutes().length, 3);
  assert.equal(createCreativeBriefBuilderOpsRoutes().length, 3);
  assert.equal(createCreativeBriefBuilderPublicRoutes().length, 3);
  assert.equal(summarizeCreativeBriefBuilderFixtures().contacts, 2);
});

