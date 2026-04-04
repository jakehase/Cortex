import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLifecycleNotebookSnapshot, createLifecycleNotebookDashboardRoutes, createLifecycleNotebookApiRoutes, createLifecycleNotebookOpsRoutes, createLifecycleNotebookPublicRoutes, createLifecycleNotebookRegistryRoutes, summarizeLifecycleNotebookFixtures } from '../packages/lifecycle-notebook/index.mjs';

test('lifecycle-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLifecycleNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLifecycleNotebookDashboardRoutes().length, 3);
  assert.equal(createLifecycleNotebookApiRoutes().length, 4);
  assert.equal(createLifecycleNotebookOpsRoutes().length, 3);
  assert.equal(createLifecycleNotebookPublicRoutes().length, 3);
  assert.equal(createLifecycleNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLifecycleNotebookFixtures().contacts, 2);
});

