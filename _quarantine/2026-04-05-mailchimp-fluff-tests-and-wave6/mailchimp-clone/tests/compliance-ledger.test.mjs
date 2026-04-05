import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceLedgerSnapshot, createComplianceLedgerDashboardRoutes, createComplianceLedgerApiRoutes, createComplianceLedgerOpsRoutes, createComplianceLedgerPublicRoutes, createComplianceLedgerRegistryRoutes, summarizeComplianceLedgerFixtures } from '../packages/compliance-ledger/index.mjs';

test('compliance-ledger generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildComplianceLedgerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createComplianceLedgerDashboardRoutes().length, 3);
  assert.equal(createComplianceLedgerApiRoutes().length, 4);
  assert.equal(createComplianceLedgerOpsRoutes().length, 3);
  assert.equal(createComplianceLedgerPublicRoutes().length, 3);
  assert.equal(createComplianceLedgerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeComplianceLedgerFixtures().contacts, 2);
});

