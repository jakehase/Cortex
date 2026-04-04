import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalizationFoundrySnapshot, createLocalizationFoundryDashboardRoutes, createLocalizationFoundryApiRoutes, createLocalizationFoundryOpsRoutes, createLocalizationFoundryPublicRoutes, createLocalizationFoundryRegistryRoutes, summarizeLocalizationFoundryFixtures } from '../packages/localization-foundry/index.mjs';

test('localization-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLocalizationFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLocalizationFoundryDashboardRoutes().length, 3);
  assert.equal(createLocalizationFoundryApiRoutes().length, 4);
  assert.equal(createLocalizationFoundryOpsRoutes().length, 3);
  assert.equal(createLocalizationFoundryPublicRoutes().length, 3);
  assert.equal(createLocalizationFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLocalizationFoundryFixtures().contacts, 2);
});

