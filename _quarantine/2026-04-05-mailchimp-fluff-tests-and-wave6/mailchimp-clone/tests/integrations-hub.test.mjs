import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegrationsHubSnapshot, createIntegrationsHubDashboardRoutes, createIntegrationsHubApiRoutes, createIntegrationsHubOpsRoutes, createIntegrationsHubPublicRoutes, createIntegrationsHubRegistryRoutes, summarizeIntegrationsHubFixtures } from '../packages/integrations-hub/index.mjs';

test('integrations-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildIntegrationsHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createIntegrationsHubDashboardRoutes().length, 3);
  assert.equal(createIntegrationsHubApiRoutes().length, 4);
  assert.equal(createIntegrationsHubOpsRoutes().length, 3);
  assert.equal(createIntegrationsHubPublicRoutes().length, 3);
  assert.equal(createIntegrationsHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeIntegrationsHubFixtures().contacts, 2);
});

