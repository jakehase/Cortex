import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegrationsPlannerSnapshot, createIntegrationsPlannerDashboardRoutes, createIntegrationsPlannerApiRoutes, createIntegrationsPlannerOpsRoutes, createIntegrationsPlannerPublicRoutes, createIntegrationsPlannerRegistryRoutes, summarizeIntegrationsPlannerFixtures } from '../packages/integrations-planner/index.mjs';

test('integrations-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildIntegrationsPlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createIntegrationsPlannerDashboardRoutes().length, 3);
  assert.equal(createIntegrationsPlannerApiRoutes().length, 4);
  assert.equal(createIntegrationsPlannerOpsRoutes().length, 3);
  assert.equal(createIntegrationsPlannerPublicRoutes().length, 3);
  assert.equal(createIntegrationsPlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeIntegrationsPlannerFixtures().contacts, 2);
});

