import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingAdvisorSnapshot, createBillingAdvisorDashboardRoutes, createBillingAdvisorApiRoutes, createBillingAdvisorOpsRoutes, createBillingAdvisorPublicRoutes, createBillingAdvisorRegistryRoutes, summarizeBillingAdvisorFixtures } from '../packages/billing-advisor/index.mjs';

test('billing-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBillingAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBillingAdvisorDashboardRoutes().length, 3);
  assert.equal(createBillingAdvisorApiRoutes().length, 4);
  assert.equal(createBillingAdvisorOpsRoutes().length, 3);
  assert.equal(createBillingAdvisorPublicRoutes().length, 3);
  assert.equal(createBillingAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBillingAdvisorFixtures().contacts, 2);
});

