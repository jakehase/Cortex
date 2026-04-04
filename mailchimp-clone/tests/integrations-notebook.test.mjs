import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegrationsNotebookSnapshot, createIntegrationsNotebookDashboardRoutes, createIntegrationsNotebookApiRoutes, createIntegrationsNotebookOpsRoutes, createIntegrationsNotebookPublicRoutes, createIntegrationsNotebookRegistryRoutes, summarizeIntegrationsNotebookFixtures } from '../packages/integrations-notebook/index.mjs';

test('integrations-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildIntegrationsNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createIntegrationsNotebookDashboardRoutes().length, 3);
  assert.equal(createIntegrationsNotebookApiRoutes().length, 4);
  assert.equal(createIntegrationsNotebookOpsRoutes().length, 3);
  assert.equal(createIntegrationsNotebookPublicRoutes().length, 3);
  assert.equal(createIntegrationsNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeIntegrationsNotebookFixtures().contacts, 2);
});

