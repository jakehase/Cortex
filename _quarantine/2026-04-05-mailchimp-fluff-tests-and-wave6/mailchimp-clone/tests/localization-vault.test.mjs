import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalizationVaultSnapshot, createLocalizationVaultDashboardRoutes, createLocalizationVaultApiRoutes, createLocalizationVaultOpsRoutes, createLocalizationVaultPublicRoutes, createLocalizationVaultRegistryRoutes, summarizeLocalizationVaultFixtures } from '../packages/localization-vault/index.mjs';

test('localization-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLocalizationVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLocalizationVaultDashboardRoutes().length, 3);
  assert.equal(createLocalizationVaultApiRoutes().length, 4);
  assert.equal(createLocalizationVaultOpsRoutes().length, 3);
  assert.equal(createLocalizationVaultPublicRoutes().length, 3);
  assert.equal(createLocalizationVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLocalizationVaultFixtures().contacts, 2);
});

