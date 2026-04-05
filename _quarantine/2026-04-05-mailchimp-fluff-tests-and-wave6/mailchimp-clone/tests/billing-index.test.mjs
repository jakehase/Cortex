import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingIndexSnapshot, createBillingIndexDashboardRoutes, createBillingIndexApiRoutes, createBillingIndexOpsRoutes, createBillingIndexPublicRoutes, createBillingIndexRegistryRoutes, summarizeBillingIndexFixtures } from '../packages/billing-index/index.mjs';

test('billing-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBillingIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBillingIndexDashboardRoutes().length, 3);
  assert.equal(createBillingIndexApiRoutes().length, 4);
  assert.equal(createBillingIndexOpsRoutes().length, 3);
  assert.equal(createBillingIndexPublicRoutes().length, 3);
  assert.equal(createBillingIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBillingIndexFixtures().contacts, 2);
});

