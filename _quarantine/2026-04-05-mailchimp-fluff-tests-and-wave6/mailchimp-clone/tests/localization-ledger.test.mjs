import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalizationLedgerSnapshot, createLocalizationLedgerDashboardRoutes, createLocalizationLedgerApiRoutes, createLocalizationLedgerOpsRoutes, createLocalizationLedgerPublicRoutes, createLocalizationLedgerRegistryRoutes, summarizeLocalizationLedgerFixtures } from '../packages/localization-ledger/index.mjs';

test('localization-ledger generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLocalizationLedgerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLocalizationLedgerDashboardRoutes().length, 3);
  assert.equal(createLocalizationLedgerApiRoutes().length, 4);
  assert.equal(createLocalizationLedgerOpsRoutes().length, 3);
  assert.equal(createLocalizationLedgerPublicRoutes().length, 3);
  assert.equal(createLocalizationLedgerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLocalizationLedgerFixtures().contacts, 2);
});

