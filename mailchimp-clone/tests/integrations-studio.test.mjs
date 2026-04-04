import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegrationsStudioSnapshot, createIntegrationsStudioDashboardRoutes, createIntegrationsStudioApiRoutes, createIntegrationsStudioOpsRoutes, createIntegrationsStudioPublicRoutes, createIntegrationsStudioRegistryRoutes, summarizeIntegrationsStudioFixtures } from '../packages/integrations-studio/index.mjs';

test('integrations-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildIntegrationsStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createIntegrationsStudioDashboardRoutes().length, 3);
  assert.equal(createIntegrationsStudioApiRoutes().length, 4);
  assert.equal(createIntegrationsStudioOpsRoutes().length, 3);
  assert.equal(createIntegrationsStudioPublicRoutes().length, 3);
  assert.equal(createIntegrationsStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeIntegrationsStudioFixtures().contacts, 2);
});

