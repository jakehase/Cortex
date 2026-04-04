import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsightsVaultSnapshot, createInsightsVaultDashboardRoutes, createInsightsVaultApiRoutes, createInsightsVaultOpsRoutes, createInsightsVaultPublicRoutes, createInsightsVaultRegistryRoutes, summarizeInsightsVaultFixtures } from '../packages/insights-vault/index.mjs';

test('insights-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildInsightsVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createInsightsVaultDashboardRoutes().length, 3);
  assert.equal(createInsightsVaultApiRoutes().length, 4);
  assert.equal(createInsightsVaultOpsRoutes().length, 3);
  assert.equal(createInsightsVaultPublicRoutes().length, 3);
  assert.equal(createInsightsVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeInsightsVaultFixtures().contacts, 2);
});

