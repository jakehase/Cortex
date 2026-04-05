import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliverabilityFoundrySnapshot, createDeliverabilityFoundryDashboardRoutes, createDeliverabilityFoundryApiRoutes, createDeliverabilityFoundryOpsRoutes, createDeliverabilityFoundryPublicRoutes, createDeliverabilityFoundryRegistryRoutes, summarizeDeliverabilityFoundryFixtures } from '../packages/deliverability-foundry/index.mjs';

test('deliverability-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDeliverabilityFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDeliverabilityFoundryDashboardRoutes().length, 3);
  assert.equal(createDeliverabilityFoundryApiRoutes().length, 4);
  assert.equal(createDeliverabilityFoundryOpsRoutes().length, 3);
  assert.equal(createDeliverabilityFoundryPublicRoutes().length, 3);
  assert.equal(createDeliverabilityFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDeliverabilityFoundryFixtures().contacts, 2);
});

