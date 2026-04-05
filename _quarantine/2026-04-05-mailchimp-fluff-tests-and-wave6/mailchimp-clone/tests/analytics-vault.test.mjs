import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsVaultSnapshot, createAnalyticsVaultDashboardRoutes, createAnalyticsVaultApiRoutes, createAnalyticsVaultOpsRoutes, createAnalyticsVaultPublicRoutes, createAnalyticsVaultRegistryRoutes, summarizeAnalyticsVaultFixtures } from '../packages/analytics-vault/index.mjs';

test('analytics-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAnalyticsVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAnalyticsVaultDashboardRoutes().length, 3);
  assert.equal(createAnalyticsVaultApiRoutes().length, 4);
  assert.equal(createAnalyticsVaultOpsRoutes().length, 3);
  assert.equal(createAnalyticsVaultPublicRoutes().length, 3);
  assert.equal(createAnalyticsVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAnalyticsVaultFixtures().contacts, 2);
});

