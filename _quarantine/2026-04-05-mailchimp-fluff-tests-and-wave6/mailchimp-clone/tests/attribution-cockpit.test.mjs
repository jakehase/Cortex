import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributionCockpitSnapshot, createAttributionCockpitDashboardRoutes, createAttributionCockpitApiRoutes, createAttributionCockpitOpsRoutes, createAttributionCockpitPublicRoutes, createAttributionCockpitRegistryRoutes, summarizeAttributionCockpitFixtures } from '../packages/attribution-cockpit/index.mjs';

test('attribution-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAttributionCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAttributionCockpitDashboardRoutes().length, 3);
  assert.equal(createAttributionCockpitApiRoutes().length, 4);
  assert.equal(createAttributionCockpitOpsRoutes().length, 3);
  assert.equal(createAttributionCockpitPublicRoutes().length, 3);
  assert.equal(createAttributionCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAttributionCockpitFixtures().contacts, 2);
});

