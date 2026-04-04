import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegrationsGridSnapshot, createIntegrationsGridDashboardRoutes, createIntegrationsGridApiRoutes, createIntegrationsGridOpsRoutes, createIntegrationsGridPublicRoutes, createIntegrationsGridRegistryRoutes, summarizeIntegrationsGridFixtures } from '../packages/integrations-grid/index.mjs';

test('integrations-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildIntegrationsGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createIntegrationsGridDashboardRoutes().length, 3);
  assert.equal(createIntegrationsGridApiRoutes().length, 4);
  assert.equal(createIntegrationsGridOpsRoutes().length, 3);
  assert.equal(createIntegrationsGridPublicRoutes().length, 3);
  assert.equal(createIntegrationsGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeIntegrationsGridFixtures().contacts, 2);
});

