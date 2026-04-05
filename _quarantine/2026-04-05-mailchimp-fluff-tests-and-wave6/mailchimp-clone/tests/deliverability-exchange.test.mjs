import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliverabilityExchangeSnapshot, createDeliverabilityExchangeDashboardRoutes, createDeliverabilityExchangeApiRoutes, createDeliverabilityExchangeOpsRoutes, createDeliverabilityExchangePublicRoutes, createDeliverabilityExchangeRegistryRoutes, summarizeDeliverabilityExchangeFixtures } from '../packages/deliverability-exchange/index.mjs';

test('deliverability-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDeliverabilityExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDeliverabilityExchangeDashboardRoutes().length, 3);
  assert.equal(createDeliverabilityExchangeApiRoutes().length, 4);
  assert.equal(createDeliverabilityExchangeOpsRoutes().length, 3);
  assert.equal(createDeliverabilityExchangePublicRoutes().length, 3);
  assert.equal(createDeliverabilityExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDeliverabilityExchangeFixtures().contacts, 2);
});

