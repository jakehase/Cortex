import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomationLedgerSnapshot, createAutomationLedgerDashboardRoutes, createAutomationLedgerApiRoutes, createAutomationLedgerOpsRoutes, createAutomationLedgerPublicRoutes, createAutomationLedgerRegistryRoutes, summarizeAutomationLedgerFixtures } from '../packages/automation-ledger/index.mjs';

test('automation-ledger generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAutomationLedgerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAutomationLedgerDashboardRoutes().length, 3);
  assert.equal(createAutomationLedgerApiRoutes().length, 4);
  assert.equal(createAutomationLedgerOpsRoutes().length, 3);
  assert.equal(createAutomationLedgerPublicRoutes().length, 3);
  assert.equal(createAutomationLedgerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAutomationLedgerFixtures().contacts, 2);
});

