import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegrationsWatchtowerSnapshot, createIntegrationsWatchtowerDashboardRoutes, createIntegrationsWatchtowerApiRoutes, createIntegrationsWatchtowerOpsRoutes, createIntegrationsWatchtowerPublicRoutes, createIntegrationsWatchtowerRegistryRoutes, summarizeIntegrationsWatchtowerFixtures } from '../packages/integrations-watchtower/index.mjs';

test('integrations-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildIntegrationsWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createIntegrationsWatchtowerDashboardRoutes().length, 3);
  assert.equal(createIntegrationsWatchtowerApiRoutes().length, 4);
  assert.equal(createIntegrationsWatchtowerOpsRoutes().length, 3);
  assert.equal(createIntegrationsWatchtowerPublicRoutes().length, 3);
  assert.equal(createIntegrationsWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeIntegrationsWatchtowerFixtures().contacts, 2);
});

