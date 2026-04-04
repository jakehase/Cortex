import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingWorkbenchSnapshot, createBillingWorkbenchDashboardRoutes, createBillingWorkbenchApiRoutes, createBillingWorkbenchOpsRoutes, createBillingWorkbenchPublicRoutes, createBillingWorkbenchRegistryRoutes, summarizeBillingWorkbenchFixtures } from '../packages/billing-workbench/index.mjs';

test('billing-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBillingWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBillingWorkbenchDashboardRoutes().length, 3);
  assert.equal(createBillingWorkbenchApiRoutes().length, 4);
  assert.equal(createBillingWorkbenchOpsRoutes().length, 3);
  assert.equal(createBillingWorkbenchPublicRoutes().length, 3);
  assert.equal(createBillingWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBillingWorkbenchFixtures().contacts, 2);
});

