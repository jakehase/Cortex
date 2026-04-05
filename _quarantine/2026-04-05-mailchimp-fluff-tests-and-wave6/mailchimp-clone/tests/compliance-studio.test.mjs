import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceStudioSnapshot, createComplianceStudioDashboardRoutes, createComplianceStudioApiRoutes, createComplianceStudioOpsRoutes, createComplianceStudioPublicRoutes, createComplianceStudioRegistryRoutes, summarizeComplianceStudioFixtures } from '../packages/compliance-studio/index.mjs';

test('compliance-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildComplianceStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createComplianceStudioDashboardRoutes().length, 3);
  assert.equal(createComplianceStudioApiRoutes().length, 4);
  assert.equal(createComplianceStudioOpsRoutes().length, 3);
  assert.equal(createComplianceStudioPublicRoutes().length, 3);
  assert.equal(createComplianceStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeComplianceStudioFixtures().contacts, 2);
});

