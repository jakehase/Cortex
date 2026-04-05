import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsightsLedgerSnapshot, createInsightsLedgerDashboardRoutes, createInsightsLedgerApiRoutes, createInsightsLedgerOpsRoutes, createInsightsLedgerPublicRoutes, createInsightsLedgerRegistryRoutes, summarizeInsightsLedgerFixtures } from '../packages/insights-ledger/index.mjs';

test('insights-ledger generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildInsightsLedgerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createInsightsLedgerDashboardRoutes().length, 3);
  assert.equal(createInsightsLedgerApiRoutes().length, 4);
  assert.equal(createInsightsLedgerOpsRoutes().length, 3);
  assert.equal(createInsightsLedgerPublicRoutes().length, 3);
  assert.equal(createInsightsLedgerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeInsightsLedgerFixtures().contacts, 2);
});

