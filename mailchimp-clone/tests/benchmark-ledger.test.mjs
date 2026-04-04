import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBenchmarkLedgerSnapshot, createBenchmarkLedgerDashboardRoutes, createBenchmarkLedgerApiRoutes, createBenchmarkLedgerOpsRoutes, createBenchmarkLedgerPublicRoutes, createBenchmarkLedgerRegistryRoutes, summarizeBenchmarkLedgerFixtures } from '../packages/benchmark-ledger/index.mjs';

test('benchmark-ledger generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBenchmarkLedgerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBenchmarkLedgerDashboardRoutes().length, 3);
  assert.equal(createBenchmarkLedgerApiRoutes().length, 4);
  assert.equal(createBenchmarkLedgerOpsRoutes().length, 3);
  assert.equal(createBenchmarkLedgerPublicRoutes().length, 3);
  assert.equal(createBenchmarkLedgerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBenchmarkLedgerFixtures().contacts, 2);
});

