import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommerceLedgerSnapshot, createCommerceLedgerDashboardRoutes, createCommerceLedgerApiRoutes, createCommerceLedgerOpsRoutes, createCommerceLedgerPublicRoutes, createCommerceLedgerRegistryRoutes, summarizeCommerceLedgerFixtures } from '../packages/commerce-ledger/index.mjs';

test('commerce-ledger generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCommerceLedgerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCommerceLedgerDashboardRoutes().length, 3);
  assert.equal(createCommerceLedgerApiRoutes().length, 4);
  assert.equal(createCommerceLedgerOpsRoutes().length, 3);
  assert.equal(createCommerceLedgerPublicRoutes().length, 3);
  assert.equal(createCommerceLedgerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCommerceLedgerFixtures().contacts, 2);
});

