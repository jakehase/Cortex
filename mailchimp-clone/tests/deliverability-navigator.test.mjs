import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliverabilityNavigatorSnapshot, createDeliverabilityNavigatorDashboardRoutes, createDeliverabilityNavigatorApiRoutes, createDeliverabilityNavigatorOpsRoutes, createDeliverabilityNavigatorPublicRoutes, createDeliverabilityNavigatorRegistryRoutes, summarizeDeliverabilityNavigatorFixtures } from '../packages/deliverability-navigator/index.mjs';

test('deliverability-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDeliverabilityNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDeliverabilityNavigatorDashboardRoutes().length, 3);
  assert.equal(createDeliverabilityNavigatorApiRoutes().length, 4);
  assert.equal(createDeliverabilityNavigatorOpsRoutes().length, 3);
  assert.equal(createDeliverabilityNavigatorPublicRoutes().length, 3);
  assert.equal(createDeliverabilityNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDeliverabilityNavigatorFixtures().contacts, 2);
});

