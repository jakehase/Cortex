import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegrationsExchangeSnapshot, createIntegrationsExchangeDashboardRoutes, createIntegrationsExchangeApiRoutes, createIntegrationsExchangeOpsRoutes, createIntegrationsExchangePublicRoutes, createIntegrationsExchangeRegistryRoutes, summarizeIntegrationsExchangeFixtures } from '../packages/integrations-exchange/index.mjs';

test('integrations-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildIntegrationsExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createIntegrationsExchangeDashboardRoutes().length, 3);
  assert.equal(createIntegrationsExchangeApiRoutes().length, 4);
  assert.equal(createIntegrationsExchangeOpsRoutes().length, 3);
  assert.equal(createIntegrationsExchangePublicRoutes().length, 3);
  assert.equal(createIntegrationsExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeIntegrationsExchangeFixtures().contacts, 2);
});

