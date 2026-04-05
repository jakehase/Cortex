import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliverabilityLedgerSnapshot, createDeliverabilityLedgerDashboardRoutes, createDeliverabilityLedgerApiRoutes, createDeliverabilityLedgerOpsRoutes, createDeliverabilityLedgerPublicRoutes, createDeliverabilityLedgerRegistryRoutes, summarizeDeliverabilityLedgerFixtures } from '../packages/deliverability-ledger/index.mjs';

test('deliverability-ledger generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDeliverabilityLedgerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDeliverabilityLedgerDashboardRoutes().length, 3);
  assert.equal(createDeliverabilityLedgerApiRoutes().length, 4);
  assert.equal(createDeliverabilityLedgerOpsRoutes().length, 3);
  assert.equal(createDeliverabilityLedgerPublicRoutes().length, 3);
  assert.equal(createDeliverabilityLedgerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDeliverabilityLedgerFixtures().contacts, 2);
});

