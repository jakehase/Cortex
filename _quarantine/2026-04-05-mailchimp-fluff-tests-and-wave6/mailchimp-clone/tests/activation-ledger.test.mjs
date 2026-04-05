import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivationLedgerSnapshot, createActivationLedgerDashboardRoutes, createActivationLedgerApiRoutes, createActivationLedgerOpsRoutes, createActivationLedgerPublicRoutes, createActivationLedgerRegistryRoutes, summarizeActivationLedgerFixtures } from '../packages/activation-ledger/index.mjs';

test('activation-ledger generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildActivationLedgerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createActivationLedgerDashboardRoutes().length, 3);
  assert.equal(createActivationLedgerApiRoutes().length, 4);
  assert.equal(createActivationLedgerOpsRoutes().length, 3);
  assert.equal(createActivationLedgerPublicRoutes().length, 3);
  assert.equal(createActivationLedgerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeActivationLedgerFixtures().contacts, 2);
});

