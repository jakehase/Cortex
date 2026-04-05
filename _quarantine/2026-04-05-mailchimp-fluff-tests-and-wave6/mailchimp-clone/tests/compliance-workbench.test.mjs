import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceWorkbenchSnapshot, createComplianceWorkbenchDashboardRoutes, createComplianceWorkbenchApiRoutes, createComplianceWorkbenchOpsRoutes, createComplianceWorkbenchPublicRoutes, createComplianceWorkbenchRegistryRoutes, summarizeComplianceWorkbenchFixtures } from '../packages/compliance-workbench/index.mjs';

test('compliance-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildComplianceWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createComplianceWorkbenchDashboardRoutes().length, 3);
  assert.equal(createComplianceWorkbenchApiRoutes().length, 4);
  assert.equal(createComplianceWorkbenchOpsRoutes().length, 3);
  assert.equal(createComplianceWorkbenchPublicRoutes().length, 3);
  assert.equal(createComplianceWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeComplianceWorkbenchFixtures().contacts, 2);
});

