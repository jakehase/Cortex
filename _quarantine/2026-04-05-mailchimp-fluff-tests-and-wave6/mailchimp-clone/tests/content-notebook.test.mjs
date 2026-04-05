import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentNotebookSnapshot, createContentNotebookDashboardRoutes, createContentNotebookApiRoutes, createContentNotebookOpsRoutes, createContentNotebookPublicRoutes, createContentNotebookRegistryRoutes, summarizeContentNotebookFixtures } from '../packages/content-notebook/index.mjs';

test('content-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildContentNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createContentNotebookDashboardRoutes().length, 3);
  assert.equal(createContentNotebookApiRoutes().length, 4);
  assert.equal(createContentNotebookOpsRoutes().length, 3);
  assert.equal(createContentNotebookPublicRoutes().length, 3);
  assert.equal(createContentNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeContentNotebookFixtures().contacts, 2);
});

