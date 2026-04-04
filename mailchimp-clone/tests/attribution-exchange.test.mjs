import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributionExchangeSnapshot, createAttributionExchangeDashboardRoutes, createAttributionExchangeApiRoutes, createAttributionExchangeOpsRoutes, createAttributionExchangePublicRoutes, createAttributionExchangeRegistryRoutes, summarizeAttributionExchangeFixtures } from '../packages/attribution-exchange/index.mjs';

test('attribution-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAttributionExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAttributionExchangeDashboardRoutes().length, 3);
  assert.equal(createAttributionExchangeApiRoutes().length, 4);
  assert.equal(createAttributionExchangeOpsRoutes().length, 3);
  assert.equal(createAttributionExchangePublicRoutes().length, 3);
  assert.equal(createAttributionExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAttributionExchangeFixtures().contacts, 2);
});

