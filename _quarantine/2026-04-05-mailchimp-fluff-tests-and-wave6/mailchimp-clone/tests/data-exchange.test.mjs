import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataExchangeSnapshot, createDataExchangeDashboardRoutes, createDataExchangeApiRoutes, createDataExchangeOpsRoutes, createDataExchangePublicRoutes, createDataExchangeRegistryRoutes, summarizeDataExchangeFixtures } from '../packages/data-exchange/index.mjs';

test('data-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDataExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDataExchangeDashboardRoutes().length, 3);
  assert.equal(createDataExchangeApiRoutes().length, 4);
  assert.equal(createDataExchangeOpsRoutes().length, 3);
  assert.equal(createDataExchangePublicRoutes().length, 3);
  assert.equal(createDataExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDataExchangeFixtures().contacts, 2);
});

