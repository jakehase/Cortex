import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivationExchangeSnapshot, createActivationExchangeDashboardRoutes, createActivationExchangeApiRoutes, createActivationExchangeOpsRoutes, createActivationExchangePublicRoutes, createActivationExchangeRegistryRoutes, summarizeActivationExchangeFixtures } from '../packages/activation-exchange/index.mjs';

test('activation-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildActivationExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createActivationExchangeDashboardRoutes().length, 3);
  assert.equal(createActivationExchangeApiRoutes().length, 4);
  assert.equal(createActivationExchangeOpsRoutes().length, 3);
  assert.equal(createActivationExchangePublicRoutes().length, 3);
  assert.equal(createActivationExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeActivationExchangeFixtures().contacts, 2);
});

