import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingRecoverySnapshot, createBillingRecoveryDashboardRoutes, createBillingRecoveryApiRoutes, createBillingRecoveryOpsRoutes, createBillingRecoveryPublicRoutes, summarizeBillingRecoveryFixtures } from '../packages/billing-recovery/index.mjs';

test('billing-recovery package deepens continuation breadth and route catalogs', () => {
  const snapshot = buildBillingRecoverySnapshot('Continuation Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Continuation Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBillingRecoveryDashboardRoutes().length, 3);
  assert.equal(createBillingRecoveryApiRoutes().length, 3);
  assert.equal(createBillingRecoveryOpsRoutes().length, 3);
  assert.equal(createBillingRecoveryPublicRoutes().length, 3);
  assert.equal(summarizeBillingRecoveryFixtures().contacts, 2);
});
