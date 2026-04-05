import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceFoundrySnapshot, createComplianceFoundryDashboardRoutes, createComplianceFoundryApiRoutes, createComplianceFoundryOpsRoutes, createComplianceFoundryPublicRoutes, createComplianceFoundryRegistryRoutes, summarizeComplianceFoundryFixtures } from '../packages/compliance-foundry/index.mjs';

test('compliance-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildComplianceFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createComplianceFoundryDashboardRoutes().length, 3);
  assert.equal(createComplianceFoundryApiRoutes().length, 4);
  assert.equal(createComplianceFoundryOpsRoutes().length, 3);
  assert.equal(createComplianceFoundryPublicRoutes().length, 3);
  assert.equal(createComplianceFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeComplianceFoundryFixtures().contacts, 2);
});

