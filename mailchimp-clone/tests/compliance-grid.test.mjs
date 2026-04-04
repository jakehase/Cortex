import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceGridSnapshot, createComplianceGridDashboardRoutes, createComplianceGridApiRoutes, createComplianceGridOpsRoutes, createComplianceGridPublicRoutes, createComplianceGridRegistryRoutes, summarizeComplianceGridFixtures } from '../packages/compliance-grid/index.mjs';

test('compliance-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildComplianceGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createComplianceGridDashboardRoutes().length, 3);
  assert.equal(createComplianceGridApiRoutes().length, 4);
  assert.equal(createComplianceGridOpsRoutes().length, 3);
  assert.equal(createComplianceGridPublicRoutes().length, 3);
  assert.equal(createComplianceGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeComplianceGridFixtures().contacts, 2);
});

