import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliverabilityIndexSnapshot, createDeliverabilityIndexDashboardRoutes, createDeliverabilityIndexApiRoutes, createDeliverabilityIndexOpsRoutes, createDeliverabilityIndexPublicRoutes, createDeliverabilityIndexRegistryRoutes, summarizeDeliverabilityIndexFixtures } from '../packages/deliverability-index/index.mjs';

test('deliverability-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDeliverabilityIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDeliverabilityIndexDashboardRoutes().length, 3);
  assert.equal(createDeliverabilityIndexApiRoutes().length, 4);
  assert.equal(createDeliverabilityIndexOpsRoutes().length, 3);
  assert.equal(createDeliverabilityIndexPublicRoutes().length, 3);
  assert.equal(createDeliverabilityIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDeliverabilityIndexFixtures().contacts, 2);
});

