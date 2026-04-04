import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributionLedgerSnapshot, createAttributionLedgerDashboardRoutes, createAttributionLedgerApiRoutes, createAttributionLedgerOpsRoutes, createAttributionLedgerPublicRoutes, createAttributionLedgerRegistryRoutes, summarizeAttributionLedgerFixtures } from '../packages/attribution-ledger/index.mjs';

test('attribution-ledger generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAttributionLedgerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAttributionLedgerDashboardRoutes().length, 3);
  assert.equal(createAttributionLedgerApiRoutes().length, 4);
  assert.equal(createAttributionLedgerOpsRoutes().length, 3);
  assert.equal(createAttributionLedgerPublicRoutes().length, 3);
  assert.equal(createAttributionLedgerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAttributionLedgerFixtures().contacts, 2);
});

