import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceLedgerSnapshot, createAudienceLedgerDashboardRoutes, createAudienceLedgerApiRoutes, createAudienceLedgerOpsRoutes, createAudienceLedgerPublicRoutes, createAudienceLedgerRegistryRoutes, summarizeAudienceLedgerFixtures } from '../packages/audience-ledger/index.mjs';

test('audience-ledger generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAudienceLedgerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAudienceLedgerDashboardRoutes().length, 3);
  assert.equal(createAudienceLedgerApiRoutes().length, 4);
  assert.equal(createAudienceLedgerOpsRoutes().length, 3);
  assert.equal(createAudienceLedgerPublicRoutes().length, 3);
  assert.equal(createAudienceLedgerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAudienceLedgerFixtures().contacts, 2);
});

