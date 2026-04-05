import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceAdvisorSnapshot, createComplianceAdvisorDashboardRoutes, createComplianceAdvisorApiRoutes, createComplianceAdvisorOpsRoutes, createComplianceAdvisorPublicRoutes, createComplianceAdvisorRegistryRoutes, summarizeComplianceAdvisorFixtures } from '../packages/compliance-advisor/index.mjs';

test('compliance-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildComplianceAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createComplianceAdvisorDashboardRoutes().length, 3);
  assert.equal(createComplianceAdvisorApiRoutes().length, 4);
  assert.equal(createComplianceAdvisorOpsRoutes().length, 3);
  assert.equal(createComplianceAdvisorPublicRoutes().length, 3);
  assert.equal(createComplianceAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeComplianceAdvisorFixtures().contacts, 2);
});

