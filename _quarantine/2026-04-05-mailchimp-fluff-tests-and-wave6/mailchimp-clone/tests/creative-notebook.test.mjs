import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativeNotebookSnapshot, createCreativeNotebookDashboardRoutes, createCreativeNotebookApiRoutes, createCreativeNotebookOpsRoutes, createCreativeNotebookPublicRoutes, createCreativeNotebookRegistryRoutes, summarizeCreativeNotebookFixtures } from '../packages/creative-notebook/index.mjs';

test('creative-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCreativeNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCreativeNotebookDashboardRoutes().length, 3);
  assert.equal(createCreativeNotebookApiRoutes().length, 4);
  assert.equal(createCreativeNotebookOpsRoutes().length, 3);
  assert.equal(createCreativeNotebookPublicRoutes().length, 3);
  assert.equal(createCreativeNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCreativeNotebookFixtures().contacts, 2);
});

