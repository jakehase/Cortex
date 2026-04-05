import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliverabilityHubSnapshot, createDeliverabilityHubDashboardRoutes, createDeliverabilityHubApiRoutes, createDeliverabilityHubOpsRoutes, createDeliverabilityHubPublicRoutes, createDeliverabilityHubRegistryRoutes, summarizeDeliverabilityHubFixtures } from '../packages/deliverability-hub/index.mjs';

test('deliverability-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDeliverabilityHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDeliverabilityHubDashboardRoutes().length, 3);
  assert.equal(createDeliverabilityHubApiRoutes().length, 4);
  assert.equal(createDeliverabilityHubOpsRoutes().length, 3);
  assert.equal(createDeliverabilityHubPublicRoutes().length, 3);
  assert.equal(createDeliverabilityHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDeliverabilityHubFixtures().contacts, 2);
});

