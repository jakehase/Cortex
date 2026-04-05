import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegrationsWorkbenchSnapshot, createIntegrationsWorkbenchDashboardRoutes, createIntegrationsWorkbenchApiRoutes, createIntegrationsWorkbenchOpsRoutes, createIntegrationsWorkbenchPublicRoutes, createIntegrationsWorkbenchRegistryRoutes, summarizeIntegrationsWorkbenchFixtures } from '../packages/integrations-workbench/index.mjs';

test('integrations-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildIntegrationsWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createIntegrationsWorkbenchDashboardRoutes().length, 3);
  assert.equal(createIntegrationsWorkbenchApiRoutes().length, 4);
  assert.equal(createIntegrationsWorkbenchOpsRoutes().length, 3);
  assert.equal(createIntegrationsWorkbenchPublicRoutes().length, 3);
  assert.equal(createIntegrationsWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeIntegrationsWorkbenchFixtures().contacts, 2);
});

