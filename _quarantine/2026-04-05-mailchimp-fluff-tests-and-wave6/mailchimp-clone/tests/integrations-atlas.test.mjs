import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegrationsAtlasSnapshot, createIntegrationsAtlasDashboardRoutes, createIntegrationsAtlasApiRoutes, createIntegrationsAtlasOpsRoutes, createIntegrationsAtlasPublicRoutes, createIntegrationsAtlasRegistryRoutes, summarizeIntegrationsAtlasFixtures } from '../packages/integrations-atlas/index.mjs';

test('integrations-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildIntegrationsAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createIntegrationsAtlasDashboardRoutes().length, 3);
  assert.equal(createIntegrationsAtlasApiRoutes().length, 4);
  assert.equal(createIntegrationsAtlasOpsRoutes().length, 3);
  assert.equal(createIntegrationsAtlasPublicRoutes().length, 3);
  assert.equal(createIntegrationsAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeIntegrationsAtlasFixtures().contacts, 2);
});

