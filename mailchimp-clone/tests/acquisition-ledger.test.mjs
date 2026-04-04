import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcquisitionLedgerSnapshot, createAcquisitionLedgerDashboardRoutes, createAcquisitionLedgerApiRoutes, createAcquisitionLedgerOpsRoutes, createAcquisitionLedgerPublicRoutes, createAcquisitionLedgerRegistryRoutes, summarizeAcquisitionLedgerFixtures } from '../packages/acquisition-ledger/index.mjs';

test('acquisition-ledger generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAcquisitionLedgerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAcquisitionLedgerDashboardRoutes().length, 3);
  assert.equal(createAcquisitionLedgerApiRoutes().length, 4);
  assert.equal(createAcquisitionLedgerOpsRoutes().length, 3);
  assert.equal(createAcquisitionLedgerPublicRoutes().length, 3);
  assert.equal(createAcquisitionLedgerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAcquisitionLedgerFixtures().contacts, 2);
});

