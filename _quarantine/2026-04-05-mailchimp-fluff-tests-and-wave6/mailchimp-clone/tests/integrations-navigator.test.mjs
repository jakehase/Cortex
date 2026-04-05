import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegrationsNavigatorSnapshot, createIntegrationsNavigatorDashboardRoutes, createIntegrationsNavigatorApiRoutes, createIntegrationsNavigatorOpsRoutes, createIntegrationsNavigatorPublicRoutes, createIntegrationsNavigatorRegistryRoutes, summarizeIntegrationsNavigatorFixtures } from '../packages/integrations-navigator/index.mjs';

test('integrations-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildIntegrationsNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createIntegrationsNavigatorDashboardRoutes().length, 3);
  assert.equal(createIntegrationsNavigatorApiRoutes().length, 4);
  assert.equal(createIntegrationsNavigatorOpsRoutes().length, 3);
  assert.equal(createIntegrationsNavigatorPublicRoutes().length, 3);
  assert.equal(createIntegrationsNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeIntegrationsNavigatorFixtures().contacts, 2);
});

