import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivationCockpitSnapshot, createActivationCockpitDashboardRoutes, createActivationCockpitApiRoutes, createActivationCockpitOpsRoutes, createActivationCockpitPublicRoutes, createActivationCockpitRegistryRoutes, summarizeActivationCockpitFixtures } from '../packages/activation-cockpit/index.mjs';

test('activation-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildActivationCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createActivationCockpitDashboardRoutes().length, 3);
  assert.equal(createActivationCockpitApiRoutes().length, 4);
  assert.equal(createActivationCockpitOpsRoutes().length, 3);
  assert.equal(createActivationCockpitPublicRoutes().length, 3);
  assert.equal(createActivationCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeActivationCockpitFixtures().contacts, 2);
});

