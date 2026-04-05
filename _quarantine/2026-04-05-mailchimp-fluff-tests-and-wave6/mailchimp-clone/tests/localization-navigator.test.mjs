import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalizationNavigatorSnapshot, createLocalizationNavigatorDashboardRoutes, createLocalizationNavigatorApiRoutes, createLocalizationNavigatorOpsRoutes, createLocalizationNavigatorPublicRoutes, createLocalizationNavigatorRegistryRoutes, summarizeLocalizationNavigatorFixtures } from '../packages/localization-navigator/index.mjs';

test('localization-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLocalizationNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLocalizationNavigatorDashboardRoutes().length, 3);
  assert.equal(createLocalizationNavigatorApiRoutes().length, 4);
  assert.equal(createLocalizationNavigatorOpsRoutes().length, 3);
  assert.equal(createLocalizationNavigatorPublicRoutes().length, 3);
  assert.equal(createLocalizationNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLocalizationNavigatorFixtures().contacts, 2);
});

