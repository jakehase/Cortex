import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegrationsSentinelSnapshot, createIntegrationsSentinelDashboardRoutes, createIntegrationsSentinelApiRoutes, createIntegrationsSentinelOpsRoutes, createIntegrationsSentinelPublicRoutes, createIntegrationsSentinelRegistryRoutes, summarizeIntegrationsSentinelFixtures } from '../packages/integrations-sentinel/index.mjs';

test('integrations-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildIntegrationsSentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createIntegrationsSentinelDashboardRoutes().length, 3);
  assert.equal(createIntegrationsSentinelApiRoutes().length, 4);
  assert.equal(createIntegrationsSentinelOpsRoutes().length, 3);
  assert.equal(createIntegrationsSentinelPublicRoutes().length, 3);
  assert.equal(createIntegrationsSentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeIntegrationsSentinelFixtures().contacts, 2);
});

