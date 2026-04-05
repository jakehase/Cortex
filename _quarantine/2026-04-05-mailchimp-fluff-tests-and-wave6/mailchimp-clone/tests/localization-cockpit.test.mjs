import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalizationCockpitSnapshot, createLocalizationCockpitDashboardRoutes, createLocalizationCockpitApiRoutes, createLocalizationCockpitOpsRoutes, createLocalizationCockpitPublicRoutes, createLocalizationCockpitRegistryRoutes, summarizeLocalizationCockpitFixtures } from '../packages/localization-cockpit/index.mjs';

test('localization-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLocalizationCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLocalizationCockpitDashboardRoutes().length, 3);
  assert.equal(createLocalizationCockpitApiRoutes().length, 4);
  assert.equal(createLocalizationCockpitOpsRoutes().length, 3);
  assert.equal(createLocalizationCockpitPublicRoutes().length, 3);
  assert.equal(createLocalizationCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLocalizationCockpitFixtures().contacts, 2);
});

