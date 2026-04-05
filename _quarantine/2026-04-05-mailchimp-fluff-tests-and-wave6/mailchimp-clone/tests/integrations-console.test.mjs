import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegrationsConsoleSnapshot, createIntegrationsConsoleDashboardRoutes, createIntegrationsConsoleApiRoutes, createIntegrationsConsoleOpsRoutes, createIntegrationsConsolePublicRoutes, createIntegrationsConsoleRegistryRoutes, summarizeIntegrationsConsoleFixtures } from '../packages/integrations-console/index.mjs';

test('integrations-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildIntegrationsConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createIntegrationsConsoleDashboardRoutes().length, 3);
  assert.equal(createIntegrationsConsoleApiRoutes().length, 4);
  assert.equal(createIntegrationsConsoleOpsRoutes().length, 3);
  assert.equal(createIntegrationsConsolePublicRoutes().length, 3);
  assert.equal(createIntegrationsConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeIntegrationsConsoleFixtures().contacts, 2);
});

