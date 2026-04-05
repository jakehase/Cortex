import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConsentExchangeSnapshot, createConsentExchangeDashboardRoutes, createConsentExchangeApiRoutes, createConsentExchangeOpsRoutes, createConsentExchangePublicRoutes, createConsentExchangeRegistryRoutes, summarizeConsentExchangeFixtures } from '../packages/consent-exchange/index.mjs';

test('consent-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildConsentExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createConsentExchangeDashboardRoutes().length, 3);
  assert.equal(createConsentExchangeApiRoutes().length, 4);
  assert.equal(createConsentExchangeOpsRoutes().length, 3);
  assert.equal(createConsentExchangePublicRoutes().length, 3);
  assert.equal(createConsentExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeConsentExchangeFixtures().contacts, 2);
});

