import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConsentLedgerSnapshot, createConsentLedgerDashboardRoutes, createConsentLedgerApiRoutes, createConsentLedgerOpsRoutes, createConsentLedgerPublicRoutes, summarizeConsentLedgerFixtures } from '../packages/consent-ledger/index.mjs';

test('consent-ledger package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildConsentLedgerSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createConsentLedgerDashboardRoutes().length, 3);
  assert.equal(createConsentLedgerApiRoutes().length, 3);
  assert.equal(createConsentLedgerOpsRoutes().length, 3);
  assert.equal(createConsentLedgerPublicRoutes().length, 3);
  assert.equal(summarizeConsentLedgerFixtures().contacts, 2);
});

