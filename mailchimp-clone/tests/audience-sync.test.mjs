import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceSyncSnapshot, createAudienceSyncDashboardRoutes, createAudienceSyncApiRoutes, createAudienceSyncOpsRoutes, createAudienceSyncPublicRoutes, summarizeAudienceSyncFixtures } from '../packages/audience-sync/index.mjs';

test('audience-sync package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildAudienceSyncSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAudienceSyncDashboardRoutes().length, 3);
  assert.equal(createAudienceSyncApiRoutes().length, 3);
  assert.equal(createAudienceSyncOpsRoutes().length, 3);
  assert.equal(createAudienceSyncPublicRoutes().length, 3);
  assert.equal(summarizeAudienceSyncFixtures().contacts, 2);
});
