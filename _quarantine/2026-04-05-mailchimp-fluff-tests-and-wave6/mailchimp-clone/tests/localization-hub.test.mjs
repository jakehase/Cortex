import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalizationHubSnapshot, createLocalizationHubDashboardRoutes, createLocalizationHubApiRoutes, createLocalizationHubOpsRoutes, createLocalizationHubPublicRoutes, createLocalizationHubRegistryRoutes, summarizeLocalizationHubFixtures } from '../packages/localization-hub/index.mjs';

test('localization-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLocalizationHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLocalizationHubDashboardRoutes().length, 3);
  assert.equal(createLocalizationHubApiRoutes().length, 4);
  assert.equal(createLocalizationHubOpsRoutes().length, 3);
  assert.equal(createLocalizationHubPublicRoutes().length, 3);
  assert.equal(createLocalizationHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLocalizationHubFixtures().contacts, 2);
});

