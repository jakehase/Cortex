import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommerceWatchtowerSnapshot, createCommerceWatchtowerDashboardRoutes, createCommerceWatchtowerApiRoutes, createCommerceWatchtowerOpsRoutes, createCommerceWatchtowerPublicRoutes, createCommerceWatchtowerRegistryRoutes, summarizeCommerceWatchtowerFixtures } from '../packages/commerce-watchtower/index.mjs';

test('commerce-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCommerceWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCommerceWatchtowerDashboardRoutes().length, 3);
  assert.equal(createCommerceWatchtowerApiRoutes().length, 4);
  assert.equal(createCommerceWatchtowerOpsRoutes().length, 3);
  assert.equal(createCommerceWatchtowerPublicRoutes().length, 3);
  assert.equal(createCommerceWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCommerceWatchtowerFixtures().contacts, 2);
});

