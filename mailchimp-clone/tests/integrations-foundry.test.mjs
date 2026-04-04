import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegrationsFoundrySnapshot, createIntegrationsFoundryDashboardRoutes, createIntegrationsFoundryApiRoutes, createIntegrationsFoundryOpsRoutes, createIntegrationsFoundryPublicRoutes, createIntegrationsFoundryRegistryRoutes, summarizeIntegrationsFoundryFixtures } from '../packages/integrations-foundry/index.mjs';

test('integrations-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildIntegrationsFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createIntegrationsFoundryDashboardRoutes().length, 3);
  assert.equal(createIntegrationsFoundryApiRoutes().length, 4);
  assert.equal(createIntegrationsFoundryOpsRoutes().length, 3);
  assert.equal(createIntegrationsFoundryPublicRoutes().length, 3);
  assert.equal(createIntegrationsFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeIntegrationsFoundryFixtures().contacts, 2);
});

