import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBenchmarkConsoleSnapshot, createBenchmarkConsoleDashboardRoutes, createBenchmarkConsoleApiRoutes, createBenchmarkConsoleOpsRoutes, createBenchmarkConsolePublicRoutes, createBenchmarkConsoleRegistryRoutes, summarizeBenchmarkConsoleFixtures } from '../packages/benchmark-console/index.mjs';

test('benchmark-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBenchmarkConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBenchmarkConsoleDashboardRoutes().length, 3);
  assert.equal(createBenchmarkConsoleApiRoutes().length, 4);
  assert.equal(createBenchmarkConsoleOpsRoutes().length, 3);
  assert.equal(createBenchmarkConsolePublicRoutes().length, 3);
  assert.equal(createBenchmarkConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBenchmarkConsoleFixtures().contacts, 2);
});

