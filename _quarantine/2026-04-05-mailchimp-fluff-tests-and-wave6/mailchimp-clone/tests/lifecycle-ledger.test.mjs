import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLifecycleLedgerSnapshot, createLifecycleLedgerDashboardRoutes, createLifecycleLedgerApiRoutes, createLifecycleLedgerOpsRoutes, createLifecycleLedgerPublicRoutes, createLifecycleLedgerRegistryRoutes, summarizeLifecycleLedgerFixtures } from '../packages/lifecycle-ledger/index.mjs';

test('lifecycle-ledger generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLifecycleLedgerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLifecycleLedgerDashboardRoutes().length, 3);
  assert.equal(createLifecycleLedgerApiRoutes().length, 4);
  assert.equal(createLifecycleLedgerOpsRoutes().length, 3);
  assert.equal(createLifecycleLedgerPublicRoutes().length, 3);
  assert.equal(createLifecycleLedgerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLifecycleLedgerFixtures().contacts, 2);
});

