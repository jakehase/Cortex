import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceVaultSnapshot, createAudienceVaultDashboardRoutes, createAudienceVaultApiRoutes, createAudienceVaultOpsRoutes, createAudienceVaultPublicRoutes, createAudienceVaultRegistryRoutes, summarizeAudienceVaultFixtures } from '../packages/audience-vault/index.mjs';

test('audience-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAudienceVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAudienceVaultDashboardRoutes().length, 3);
  assert.equal(createAudienceVaultApiRoutes().length, 4);
  assert.equal(createAudienceVaultOpsRoutes().length, 3);
  assert.equal(createAudienceVaultPublicRoutes().length, 3);
  assert.equal(createAudienceVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAudienceVaultFixtures().contacts, 2);
});

