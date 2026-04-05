import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativeLedgerSnapshot, createCreativeLedgerDashboardRoutes, createCreativeLedgerApiRoutes, createCreativeLedgerOpsRoutes, createCreativeLedgerPublicRoutes, createCreativeLedgerRegistryRoutes, summarizeCreativeLedgerFixtures } from '../packages/creative-ledger/index.mjs';

test('creative-ledger generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCreativeLedgerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCreativeLedgerDashboardRoutes().length, 3);
  assert.equal(createCreativeLedgerApiRoutes().length, 4);
  assert.equal(createCreativeLedgerOpsRoutes().length, 3);
  assert.equal(createCreativeLedgerPublicRoutes().length, 3);
  assert.equal(createCreativeLedgerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCreativeLedgerFixtures().contacts, 2);
});

