import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliverabilityWatchtowerSnapshot, createDeliverabilityWatchtowerDashboardRoutes, createDeliverabilityWatchtowerApiRoutes, createDeliverabilityWatchtowerOpsRoutes, createDeliverabilityWatchtowerPublicRoutes, createDeliverabilityWatchtowerRegistryRoutes, summarizeDeliverabilityWatchtowerFixtures } from '../packages/deliverability-watchtower/index.mjs';

test('deliverability-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDeliverabilityWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDeliverabilityWatchtowerDashboardRoutes().length, 3);
  assert.equal(createDeliverabilityWatchtowerApiRoutes().length, 4);
  assert.equal(createDeliverabilityWatchtowerOpsRoutes().length, 3);
  assert.equal(createDeliverabilityWatchtowerPublicRoutes().length, 3);
  assert.equal(createDeliverabilityWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDeliverabilityWatchtowerFixtures().contacts, 2);
});

