import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceIndexSnapshot, createComplianceIndexDashboardRoutes, createComplianceIndexApiRoutes, createComplianceIndexOpsRoutes, createComplianceIndexPublicRoutes, createComplianceIndexRegistryRoutes, summarizeComplianceIndexFixtures } from '../packages/compliance-index/index.mjs';

test('compliance-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildComplianceIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createComplianceIndexDashboardRoutes().length, 3);
  assert.equal(createComplianceIndexApiRoutes().length, 4);
  assert.equal(createComplianceIndexOpsRoutes().length, 3);
  assert.equal(createComplianceIndexPublicRoutes().length, 3);
  assert.equal(createComplianceIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeComplianceIndexFixtures().contacts, 2);
});

