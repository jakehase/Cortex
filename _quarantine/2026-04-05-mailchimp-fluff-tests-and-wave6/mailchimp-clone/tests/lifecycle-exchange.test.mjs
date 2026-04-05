import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLifecycleExchangeSnapshot, createLifecycleExchangeDashboardRoutes, createLifecycleExchangeApiRoutes, createLifecycleExchangeOpsRoutes, createLifecycleExchangePublicRoutes, createLifecycleExchangeRegistryRoutes, summarizeLifecycleExchangeFixtures } from '../packages/lifecycle-exchange/index.mjs';

test('lifecycle-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLifecycleExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLifecycleExchangeDashboardRoutes().length, 3);
  assert.equal(createLifecycleExchangeApiRoutes().length, 4);
  assert.equal(createLifecycleExchangeOpsRoutes().length, 3);
  assert.equal(createLifecycleExchangePublicRoutes().length, 3);
  assert.equal(createLifecycleExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLifecycleExchangeFixtures().contacts, 2);
});

