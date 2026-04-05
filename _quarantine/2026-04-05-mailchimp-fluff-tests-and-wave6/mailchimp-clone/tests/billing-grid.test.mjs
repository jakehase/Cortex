import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingGridSnapshot, createBillingGridDashboardRoutes, createBillingGridApiRoutes, createBillingGridOpsRoutes, createBillingGridPublicRoutes, createBillingGridRegistryRoutes, summarizeBillingGridFixtures } from '../packages/billing-grid/index.mjs';

test('billing-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBillingGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBillingGridDashboardRoutes().length, 3);
  assert.equal(createBillingGridApiRoutes().length, 4);
  assert.equal(createBillingGridOpsRoutes().length, 3);
  assert.equal(createBillingGridPublicRoutes().length, 3);
  assert.equal(createBillingGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBillingGridFixtures().contacts, 2);
});

