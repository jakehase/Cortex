import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBenchmarkWorkbenchSnapshot, createBenchmarkWorkbenchDashboardRoutes, createBenchmarkWorkbenchApiRoutes, createBenchmarkWorkbenchOpsRoutes, createBenchmarkWorkbenchPublicRoutes, createBenchmarkWorkbenchRegistryRoutes, summarizeBenchmarkWorkbenchFixtures } from '../packages/benchmark-workbench/index.mjs';

test('benchmark-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBenchmarkWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBenchmarkWorkbenchDashboardRoutes().length, 3);
  assert.equal(createBenchmarkWorkbenchApiRoutes().length, 4);
  assert.equal(createBenchmarkWorkbenchOpsRoutes().length, 3);
  assert.equal(createBenchmarkWorkbenchPublicRoutes().length, 3);
  assert.equal(createBenchmarkWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBenchmarkWorkbenchFixtures().contacts, 2);
});

