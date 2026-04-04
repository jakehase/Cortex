import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliverabilityCockpitSnapshot, createDeliverabilityCockpitDashboardRoutes, createDeliverabilityCockpitApiRoutes, createDeliverabilityCockpitOpsRoutes, createDeliverabilityCockpitPublicRoutes, createDeliverabilityCockpitRegistryRoutes, summarizeDeliverabilityCockpitFixtures } from '../packages/deliverability-cockpit/index.mjs';

test('deliverability-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDeliverabilityCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDeliverabilityCockpitDashboardRoutes().length, 3);
  assert.equal(createDeliverabilityCockpitApiRoutes().length, 4);
  assert.equal(createDeliverabilityCockpitOpsRoutes().length, 3);
  assert.equal(createDeliverabilityCockpitPublicRoutes().length, 3);
  assert.equal(createDeliverabilityCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDeliverabilityCockpitFixtures().contacts, 2);
});

