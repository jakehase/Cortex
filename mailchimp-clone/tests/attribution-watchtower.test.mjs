import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributionWatchtowerSnapshot, createAttributionWatchtowerDashboardRoutes, createAttributionWatchtowerApiRoutes, createAttributionWatchtowerOpsRoutes, createAttributionWatchtowerPublicRoutes, createAttributionWatchtowerRegistryRoutes, summarizeAttributionWatchtowerFixtures } from '../packages/attribution-watchtower/index.mjs';

test('attribution-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAttributionWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAttributionWatchtowerDashboardRoutes().length, 3);
  assert.equal(createAttributionWatchtowerApiRoutes().length, 4);
  assert.equal(createAttributionWatchtowerOpsRoutes().length, 3);
  assert.equal(createAttributionWatchtowerPublicRoutes().length, 3);
  assert.equal(createAttributionWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAttributionWatchtowerFixtures().contacts, 2);
});

