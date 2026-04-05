import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceNotebookSnapshot, createComplianceNotebookDashboardRoutes, createComplianceNotebookApiRoutes, createComplianceNotebookOpsRoutes, createComplianceNotebookPublicRoutes, createComplianceNotebookRegistryRoutes, summarizeComplianceNotebookFixtures } from '../packages/compliance-notebook/index.mjs';

test('compliance-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildComplianceNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createComplianceNotebookDashboardRoutes().length, 3);
  assert.equal(createComplianceNotebookApiRoutes().length, 4);
  assert.equal(createComplianceNotebookOpsRoutes().length, 3);
  assert.equal(createComplianceNotebookPublicRoutes().length, 3);
  assert.equal(createComplianceNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeComplianceNotebookFixtures().contacts, 2);
});

