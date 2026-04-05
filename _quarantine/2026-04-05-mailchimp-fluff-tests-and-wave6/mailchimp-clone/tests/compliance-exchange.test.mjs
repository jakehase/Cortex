import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceExchangeSnapshot, createComplianceExchangeDashboardRoutes, createComplianceExchangeApiRoutes, createComplianceExchangeOpsRoutes, createComplianceExchangePublicRoutes, createComplianceExchangeRegistryRoutes, summarizeComplianceExchangeFixtures } from '../packages/compliance-exchange/index.mjs';

test('compliance-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildComplianceExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createComplianceExchangeDashboardRoutes().length, 3);
  assert.equal(createComplianceExchangeApiRoutes().length, 4);
  assert.equal(createComplianceExchangeOpsRoutes().length, 3);
  assert.equal(createComplianceExchangePublicRoutes().length, 3);
  assert.equal(createComplianceExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeComplianceExchangeFixtures().contacts, 2);
});

