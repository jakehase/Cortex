import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentLedgerSnapshot, createContentLedgerDashboardRoutes, createContentLedgerApiRoutes, createContentLedgerOpsRoutes, createContentLedgerPublicRoutes, createContentLedgerRegistryRoutes, summarizeContentLedgerFixtures } from '../packages/content-ledger/index.mjs';

test('content-ledger generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildContentLedgerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createContentLedgerDashboardRoutes().length, 3);
  assert.equal(createContentLedgerApiRoutes().length, 4);
  assert.equal(createContentLedgerOpsRoutes().length, 3);
  assert.equal(createContentLedgerPublicRoutes().length, 3);
  assert.equal(createContentLedgerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeContentLedgerFixtures().contacts, 2);
});

