import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliverabilityGridSnapshot, createDeliverabilityGridDashboardRoutes, createDeliverabilityGridApiRoutes, createDeliverabilityGridOpsRoutes, createDeliverabilityGridPublicRoutes, createDeliverabilityGridRegistryRoutes, summarizeDeliverabilityGridFixtures } from '../packages/deliverability-grid/index.mjs';

test('deliverability-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDeliverabilityGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDeliverabilityGridDashboardRoutes().length, 3);
  assert.equal(createDeliverabilityGridApiRoutes().length, 4);
  assert.equal(createDeliverabilityGridOpsRoutes().length, 3);
  assert.equal(createDeliverabilityGridPublicRoutes().length, 3);
  assert.equal(createDeliverabilityGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDeliverabilityGridFixtures().contacts, 2);
});

