import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomationNotebookSnapshot, createAutomationNotebookDashboardRoutes, createAutomationNotebookApiRoutes, createAutomationNotebookOpsRoutes, createAutomationNotebookPublicRoutes, createAutomationNotebookRegistryRoutes, summarizeAutomationNotebookFixtures } from '../packages/automation-notebook/index.mjs';

test('automation-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAutomationNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAutomationNotebookDashboardRoutes().length, 3);
  assert.equal(createAutomationNotebookApiRoutes().length, 4);
  assert.equal(createAutomationNotebookOpsRoutes().length, 3);
  assert.equal(createAutomationNotebookPublicRoutes().length, 3);
  assert.equal(createAutomationNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAutomationNotebookFixtures().contacts, 2);
});

