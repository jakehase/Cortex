import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingLedgerSnapshot, createBillingLedgerDashboardRoutes, createBillingLedgerApiRoutes, createBillingLedgerOpsRoutes, createBillingLedgerPublicRoutes, createBillingLedgerRegistryRoutes, summarizeBillingLedgerFixtures } from '../packages/billing-ledger/index.mjs';

test('billing-ledger generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBillingLedgerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBillingLedgerDashboardRoutes().length, 3);
  assert.equal(createBillingLedgerApiRoutes().length, 4);
  assert.equal(createBillingLedgerOpsRoutes().length, 3);
  assert.equal(createBillingLedgerPublicRoutes().length, 3);
  assert.equal(createBillingLedgerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBillingLedgerFixtures().contacts, 2);
});

