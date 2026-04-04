import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivationFoundrySnapshot, createActivationFoundryDashboardRoutes, createActivationFoundryApiRoutes, createActivationFoundryOpsRoutes, createActivationFoundryPublicRoutes, createActivationFoundryRegistryRoutes, summarizeActivationFoundryFixtures } from '../packages/activation-foundry/index.mjs';

test('activation-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildActivationFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createActivationFoundryDashboardRoutes().length, 3);
  assert.equal(createActivationFoundryApiRoutes().length, 4);
  assert.equal(createActivationFoundryOpsRoutes().length, 3);
  assert.equal(createActivationFoundryPublicRoutes().length, 3);
  assert.equal(createActivationFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeActivationFoundryFixtures().contacts, 2);
});

