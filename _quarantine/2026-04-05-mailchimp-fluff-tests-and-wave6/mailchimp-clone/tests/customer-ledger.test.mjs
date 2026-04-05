import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerLedgerSnapshot, createCustomerLedgerDashboardRoutes, createCustomerLedgerApiRoutes, createCustomerLedgerOpsRoutes, createCustomerLedgerPublicRoutes, createCustomerLedgerRegistryRoutes, summarizeCustomerLedgerFixtures } from '../packages/customer-ledger/index.mjs';

test('customer-ledger generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCustomerLedgerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCustomerLedgerDashboardRoutes().length, 3);
  assert.equal(createCustomerLedgerApiRoutes().length, 4);
  assert.equal(createCustomerLedgerOpsRoutes().length, 3);
  assert.equal(createCustomerLedgerPublicRoutes().length, 3);
  assert.equal(createCustomerLedgerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCustomerLedgerFixtures().contacts, 2);
});

