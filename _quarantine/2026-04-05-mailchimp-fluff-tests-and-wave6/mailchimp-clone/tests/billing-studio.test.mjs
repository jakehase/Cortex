import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingStudioSnapshot, createBillingStudioDashboardRoutes, createBillingStudioApiRoutes, createBillingStudioOpsRoutes, createBillingStudioPublicRoutes, createBillingStudioRegistryRoutes, summarizeBillingStudioFixtures } from '../packages/billing-studio/index.mjs';

test('billing-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBillingStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBillingStudioDashboardRoutes().length, 3);
  assert.equal(createBillingStudioApiRoutes().length, 4);
  assert.equal(createBillingStudioOpsRoutes().length, 3);
  assert.equal(createBillingStudioPublicRoutes().length, 3);
  assert.equal(createBillingStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBillingStudioFixtures().contacts, 2);
});

