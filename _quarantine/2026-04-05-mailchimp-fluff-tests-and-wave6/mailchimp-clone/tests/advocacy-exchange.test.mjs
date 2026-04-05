import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvocacyExchangeSnapshot, createAdvocacyExchangeDashboardRoutes, createAdvocacyExchangeApiRoutes, createAdvocacyExchangeOpsRoutes, createAdvocacyExchangePublicRoutes, createAdvocacyExchangeRegistryRoutes, summarizeAdvocacyExchangeFixtures } from '../packages/advocacy-exchange/index.mjs';

test('advocacy-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAdvocacyExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAdvocacyExchangeDashboardRoutes().length, 3);
  assert.equal(createAdvocacyExchangeApiRoutes().length, 4);
  assert.equal(createAdvocacyExchangeOpsRoutes().length, 3);
  assert.equal(createAdvocacyExchangePublicRoutes().length, 3);
  assert.equal(createAdvocacyExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAdvocacyExchangeFixtures().contacts, 2);
});

