import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivationHubSnapshot, createActivationHubDashboardRoutes, createActivationHubApiRoutes, createActivationHubOpsRoutes, createActivationHubPublicRoutes, createActivationHubRegistryRoutes, summarizeActivationHubFixtures } from '../packages/activation-hub/index.mjs';

test('activation-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildActivationHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createActivationHubDashboardRoutes().length, 3);
  assert.equal(createActivationHubApiRoutes().length, 4);
  assert.equal(createActivationHubOpsRoutes().length, 3);
  assert.equal(createActivationHubPublicRoutes().length, 3);
  assert.equal(createActivationHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeActivationHubFixtures().contacts, 2);
});

