import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvocacyLedgerSnapshot, createAdvocacyLedgerDashboardRoutes, createAdvocacyLedgerApiRoutes, createAdvocacyLedgerOpsRoutes, createAdvocacyLedgerPublicRoutes, createAdvocacyLedgerRegistryRoutes, summarizeAdvocacyLedgerFixtures } from '../packages/advocacy-ledger/index.mjs';

test('advocacy-ledger generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAdvocacyLedgerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAdvocacyLedgerDashboardRoutes().length, 3);
  assert.equal(createAdvocacyLedgerApiRoutes().length, 4);
  assert.equal(createAdvocacyLedgerOpsRoutes().length, 3);
  assert.equal(createAdvocacyLedgerPublicRoutes().length, 3);
  assert.equal(createAdvocacyLedgerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAdvocacyLedgerFixtures().contacts, 2);
});

