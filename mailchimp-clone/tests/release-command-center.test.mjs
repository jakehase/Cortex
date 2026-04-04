import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReleaseCommandCenterSnapshot, createReleaseCommandCenterDashboardRoutes, createReleaseCommandCenterApiRoutes, createReleaseCommandCenterOpsRoutes, createReleaseCommandCenterPublicRoutes, summarizeReleaseCommandCenterFixtures } from '../packages/release-command-center/index.mjs';

test('release-command-center package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildReleaseCommandCenterSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createReleaseCommandCenterDashboardRoutes().length, 3);
  assert.equal(createReleaseCommandCenterApiRoutes().length, 3);
  assert.equal(createReleaseCommandCenterOpsRoutes().length, 3);
  assert.equal(createReleaseCommandCenterPublicRoutes().length, 3);
  assert.equal(summarizeReleaseCommandCenterFixtures().contacts, 2);
});

