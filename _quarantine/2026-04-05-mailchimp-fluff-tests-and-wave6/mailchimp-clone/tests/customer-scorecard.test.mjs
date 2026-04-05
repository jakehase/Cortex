import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerScorecardSnapshot, createCustomerScorecardDashboardRoutes, createCustomerScorecardApiRoutes, createCustomerScorecardOpsRoutes, createCustomerScorecardPublicRoutes, createCustomerScorecardRegistryRoutes, summarizeCustomerScorecardFixtures } from '../packages/customer-scorecard/index.mjs';

test('customer-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCustomerScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCustomerScorecardDashboardRoutes().length, 3);
  assert.equal(createCustomerScorecardApiRoutes().length, 4);
  assert.equal(createCustomerScorecardOpsRoutes().length, 3);
  assert.equal(createCustomerScorecardPublicRoutes().length, 3);
  assert.equal(createCustomerScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCustomerScorecardFixtures().contacts, 2);
});

