import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceHubSnapshot, createComplianceHubDashboardRoutes, createComplianceHubApiRoutes, createComplianceHubOpsRoutes, createComplianceHubPublicRoutes, createComplianceHubRegistryRoutes, summarizeComplianceHubFixtures } from '../packages/compliance-hub/index.mjs';

test('compliance-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildComplianceHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createComplianceHubDashboardRoutes().length, 3);
  assert.equal(createComplianceHubApiRoutes().length, 4);
  assert.equal(createComplianceHubOpsRoutes().length, 3);
  assert.equal(createComplianceHubPublicRoutes().length, 3);
  assert.equal(createComplianceHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeComplianceHubFixtures().contacts, 2);
});

