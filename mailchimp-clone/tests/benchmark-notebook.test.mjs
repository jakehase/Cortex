import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBenchmarkNotebookSnapshot, createBenchmarkNotebookDashboardRoutes, createBenchmarkNotebookApiRoutes, createBenchmarkNotebookOpsRoutes, createBenchmarkNotebookPublicRoutes, createBenchmarkNotebookRegistryRoutes, summarizeBenchmarkNotebookFixtures } from '../packages/benchmark-notebook/index.mjs';

test('benchmark-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBenchmarkNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBenchmarkNotebookDashboardRoutes().length, 3);
  assert.equal(createBenchmarkNotebookApiRoutes().length, 4);
  assert.equal(createBenchmarkNotebookOpsRoutes().length, 3);
  assert.equal(createBenchmarkNotebookPublicRoutes().length, 3);
  assert.equal(createBenchmarkNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBenchmarkNotebookFixtures().contacts, 2);
});

