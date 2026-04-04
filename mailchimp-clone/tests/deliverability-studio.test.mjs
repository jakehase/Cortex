import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliverabilityStudioSnapshot, createDeliverabilityStudioDashboardRoutes, createDeliverabilityStudioApiRoutes, createDeliverabilityStudioOpsRoutes, createDeliverabilityStudioPublicRoutes, createDeliverabilityStudioRegistryRoutes, summarizeDeliverabilityStudioFixtures } from '../packages/deliverability-studio/index.mjs';

test('deliverability-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDeliverabilityStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDeliverabilityStudioDashboardRoutes().length, 3);
  assert.equal(createDeliverabilityStudioApiRoutes().length, 4);
  assert.equal(createDeliverabilityStudioOpsRoutes().length, 3);
  assert.equal(createDeliverabilityStudioPublicRoutes().length, 3);
  assert.equal(createDeliverabilityStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDeliverabilityStudioFixtures().contacts, 2);
});

