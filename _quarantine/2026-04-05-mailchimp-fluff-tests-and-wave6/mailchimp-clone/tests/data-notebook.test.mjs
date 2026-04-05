import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataNotebookSnapshot, createDataNotebookDashboardRoutes, createDataNotebookApiRoutes, createDataNotebookOpsRoutes, createDataNotebookPublicRoutes, createDataNotebookRegistryRoutes, summarizeDataNotebookFixtures } from '../packages/data-notebook/index.mjs';

test('data-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDataNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDataNotebookDashboardRoutes().length, 3);
  assert.equal(createDataNotebookApiRoutes().length, 4);
  assert.equal(createDataNotebookOpsRoutes().length, 3);
  assert.equal(createDataNotebookPublicRoutes().length, 3);
  assert.equal(createDataNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDataNotebookFixtures().contacts, 2);
});

