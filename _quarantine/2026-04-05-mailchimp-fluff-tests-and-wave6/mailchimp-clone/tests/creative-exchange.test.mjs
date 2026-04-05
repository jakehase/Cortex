import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativeExchangeSnapshot, createCreativeExchangeDashboardRoutes, createCreativeExchangeApiRoutes, createCreativeExchangeOpsRoutes, createCreativeExchangePublicRoutes, createCreativeExchangeRegistryRoutes, summarizeCreativeExchangeFixtures } from '../packages/creative-exchange/index.mjs';

test('creative-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCreativeExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCreativeExchangeDashboardRoutes().length, 3);
  assert.equal(createCreativeExchangeApiRoutes().length, 4);
  assert.equal(createCreativeExchangeOpsRoutes().length, 3);
  assert.equal(createCreativeExchangePublicRoutes().length, 3);
  assert.equal(createCreativeExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCreativeExchangeFixtures().contacts, 2);
});

