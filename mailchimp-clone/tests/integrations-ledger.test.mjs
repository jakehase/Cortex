import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegrationsLedgerSnapshot, createIntegrationsLedgerDashboardRoutes, createIntegrationsLedgerApiRoutes, createIntegrationsLedgerOpsRoutes, createIntegrationsLedgerPublicRoutes, createIntegrationsLedgerRegistryRoutes, summarizeIntegrationsLedgerFixtures } from '../packages/integrations-ledger/index.mjs';

test('integrations-ledger generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildIntegrationsLedgerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createIntegrationsLedgerDashboardRoutes().length, 3);
  assert.equal(createIntegrationsLedgerApiRoutes().length, 4);
  assert.equal(createIntegrationsLedgerOpsRoutes().length, 3);
  assert.equal(createIntegrationsLedgerPublicRoutes().length, 3);
  assert.equal(createIntegrationsLedgerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeIntegrationsLedgerFixtures().contacts, 2);
});

