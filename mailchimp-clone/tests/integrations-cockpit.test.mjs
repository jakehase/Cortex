import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegrationsCockpitSnapshot, createIntegrationsCockpitDashboardRoutes, createIntegrationsCockpitApiRoutes, createIntegrationsCockpitOpsRoutes, createIntegrationsCockpitPublicRoutes, createIntegrationsCockpitRegistryRoutes, summarizeIntegrationsCockpitFixtures } from '../packages/integrations-cockpit/index.mjs';

test('integrations-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildIntegrationsCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createIntegrationsCockpitDashboardRoutes().length, 3);
  assert.equal(createIntegrationsCockpitApiRoutes().length, 4);
  assert.equal(createIntegrationsCockpitOpsRoutes().length, 3);
  assert.equal(createIntegrationsCockpitPublicRoutes().length, 3);
  assert.equal(createIntegrationsCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeIntegrationsCockpitFixtures().contacts, 2);
});

