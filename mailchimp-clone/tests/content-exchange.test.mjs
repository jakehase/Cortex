import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentExchangeSnapshot, createContentExchangeDashboardRoutes, createContentExchangeApiRoutes, createContentExchangeOpsRoutes, createContentExchangePublicRoutes, createContentExchangeRegistryRoutes, summarizeContentExchangeFixtures } from '../packages/content-exchange/index.mjs';

test('content-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildContentExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createContentExchangeDashboardRoutes().length, 3);
  assert.equal(createContentExchangeApiRoutes().length, 4);
  assert.equal(createContentExchangeOpsRoutes().length, 3);
  assert.equal(createContentExchangePublicRoutes().length, 3);
  assert.equal(createContentExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeContentExchangeFixtures().contacts, 2);
});

