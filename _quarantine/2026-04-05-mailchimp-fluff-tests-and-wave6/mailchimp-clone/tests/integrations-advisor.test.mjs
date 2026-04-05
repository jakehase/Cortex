import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegrationsAdvisorSnapshot, createIntegrationsAdvisorDashboardRoutes, createIntegrationsAdvisorApiRoutes, createIntegrationsAdvisorOpsRoutes, createIntegrationsAdvisorPublicRoutes, createIntegrationsAdvisorRegistryRoutes, summarizeIntegrationsAdvisorFixtures } from '../packages/integrations-advisor/index.mjs';

test('integrations-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildIntegrationsAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createIntegrationsAdvisorDashboardRoutes().length, 3);
  assert.equal(createIntegrationsAdvisorApiRoutes().length, 4);
  assert.equal(createIntegrationsAdvisorOpsRoutes().length, 3);
  assert.equal(createIntegrationsAdvisorPublicRoutes().length, 3);
  assert.equal(createIntegrationsAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeIntegrationsAdvisorFixtures().contacts, 2);
});

