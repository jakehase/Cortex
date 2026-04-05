import test from 'node:test';
import assert from 'node:assert/strict';
import { createConsentLedgerDashboardRoutes, createConsentLedgerApiRoutes, createConsentLedgerOpsRoutes, createConsentLedgerPublicRoutes } from '../packages/consent-ledger/index.mjs';

test('consent-ledger routes honor custom base paths and stable ids', () => {
  const dashboard = createConsentLedgerDashboardRoutes('/labs/consent-ledger');
  const api = createConsentLedgerApiRoutes('/api/labs/consent-ledger');
  const ops = createConsentLedgerOpsRoutes('/ops/labs/consent-ledger');
  const pub = createConsentLedgerPublicRoutes('/public/labs/consent-ledger');
  assert.equal(dashboard[0].path, '/labs/consent-ledger');
  assert.equal(api[0].path, '/api/labs/consent-ledger/overview');
  assert.equal(ops[0].path, '/ops/labs/consent-ledger/health');
  assert.equal(pub[0].path, '/public/labs/consent-ledger');
  assert.match(dashboard[0].id, /consent\-ledger/);
  assert.match(api[2].id, /consent\-ledger/);
});

