import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMultiAccountControlSnapshot, createMultiAccountControlDashboardRoutes, createMultiAccountControlApiRoutes, createMultiAccountControlOpsRoutes, createMultiAccountControlPublicRoutes, summarizeMultiAccountControlFixtures } from '../packages/multi-account-control/index.mjs';

test('multi-account-control package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildMultiAccountControlSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createMultiAccountControlDashboardRoutes().length, 3);
  assert.equal(createMultiAccountControlApiRoutes().length, 3);
  assert.equal(createMultiAccountControlOpsRoutes().length, 3);
  assert.equal(createMultiAccountControlPublicRoutes().length, 3);
  assert.equal(summarizeMultiAccountControlFixtures().contacts, 2);
});

