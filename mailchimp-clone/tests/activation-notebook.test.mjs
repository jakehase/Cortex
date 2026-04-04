import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivationNotebookSnapshot, createActivationNotebookDashboardRoutes, createActivationNotebookApiRoutes, createActivationNotebookOpsRoutes, createActivationNotebookPublicRoutes, createActivationNotebookRegistryRoutes, summarizeActivationNotebookFixtures } from '../packages/activation-notebook/index.mjs';

test('activation-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildActivationNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createActivationNotebookDashboardRoutes().length, 3);
  assert.equal(createActivationNotebookApiRoutes().length, 4);
  assert.equal(createActivationNotebookOpsRoutes().length, 3);
  assert.equal(createActivationNotebookPublicRoutes().length, 3);
  assert.equal(createActivationNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeActivationNotebookFixtures().contacts, 2);
});

