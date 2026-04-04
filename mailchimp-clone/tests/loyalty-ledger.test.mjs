import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoyaltyLedgerSnapshot, createLoyaltyLedgerDashboardRoutes, createLoyaltyLedgerApiRoutes, createLoyaltyLedgerOpsRoutes, createLoyaltyLedgerPublicRoutes, createLoyaltyLedgerRegistryRoutes, summarizeLoyaltyLedgerFixtures } from '../packages/loyalty-ledger/index.mjs';

test('loyalty-ledger generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLoyaltyLedgerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLoyaltyLedgerDashboardRoutes().length, 3);
  assert.equal(createLoyaltyLedgerApiRoutes().length, 4);
  assert.equal(createLoyaltyLedgerOpsRoutes().length, 3);
  assert.equal(createLoyaltyLedgerPublicRoutes().length, 3);
  assert.equal(createLoyaltyLedgerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLoyaltyLedgerFixtures().contacts, 2);
});

