import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativeIndexSnapshot, createCreativeIndexDashboardRoutes, createCreativeIndexApiRoutes, createCreativeIndexOpsRoutes, createCreativeIndexPublicRoutes, createCreativeIndexRegistryRoutes, summarizeCreativeIndexFixtures } from '../packages/creative-index/index.mjs';

test('creative-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCreativeIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCreativeIndexDashboardRoutes().length, 3);
  assert.equal(createCreativeIndexApiRoutes().length, 4);
  assert.equal(createCreativeIndexOpsRoutes().length, 3);
  assert.equal(createCreativeIndexPublicRoutes().length, 3);
  assert.equal(createCreativeIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCreativeIndexFixtures().contacts, 2);
});

