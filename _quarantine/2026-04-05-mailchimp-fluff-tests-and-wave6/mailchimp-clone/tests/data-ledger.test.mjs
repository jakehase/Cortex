import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataLedgerSnapshot, createDataLedgerDashboardRoutes, createDataLedgerApiRoutes, createDataLedgerOpsRoutes, createDataLedgerPublicRoutes, createDataLedgerRegistryRoutes, summarizeDataLedgerFixtures } from '../packages/data-ledger/index.mjs';

test('data-ledger generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDataLedgerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDataLedgerDashboardRoutes().length, 3);
  assert.equal(createDataLedgerApiRoutes().length, 4);
  assert.equal(createDataLedgerOpsRoutes().length, 3);
  assert.equal(createDataLedgerPublicRoutes().length, 3);
  assert.equal(createDataLedgerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDataLedgerFixtures().contacts, 2);
});

