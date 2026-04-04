import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsLedgerSnapshot, createAnalyticsLedgerDashboardRoutes, createAnalyticsLedgerApiRoutes, createAnalyticsLedgerOpsRoutes, createAnalyticsLedgerPublicRoutes, createAnalyticsLedgerRegistryRoutes, summarizeAnalyticsLedgerFixtures } from '../packages/analytics-ledger/index.mjs';

test('analytics-ledger generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAnalyticsLedgerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAnalyticsLedgerDashboardRoutes().length, 3);
  assert.equal(createAnalyticsLedgerApiRoutes().length, 4);
  assert.equal(createAnalyticsLedgerOpsRoutes().length, 3);
  assert.equal(createAnalyticsLedgerPublicRoutes().length, 3);
  assert.equal(createAnalyticsLedgerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAnalyticsLedgerFixtures().contacts, 2);
});

