import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRetentionLabSnapshot, createRetentionLabDashboardRoutes, createRetentionLabApiRoutes, createRetentionLabOpsRoutes, createRetentionLabPublicRoutes, summarizeRetentionLabFixtures } from '../packages/retention-lab/index.mjs';

test('retention-lab package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildRetentionLabSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createRetentionLabDashboardRoutes().length, 3);
  assert.equal(createRetentionLabApiRoutes().length, 3);
  assert.equal(createRetentionLabOpsRoutes().length, 3);
  assert.equal(createRetentionLabPublicRoutes().length, 3);
  assert.equal(summarizeRetentionLabFixtures().contacts, 2);
});
