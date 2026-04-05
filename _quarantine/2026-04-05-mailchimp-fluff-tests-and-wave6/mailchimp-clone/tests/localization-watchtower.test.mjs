import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalizationWatchtowerSnapshot, createLocalizationWatchtowerDashboardRoutes, createLocalizationWatchtowerApiRoutes, createLocalizationWatchtowerOpsRoutes, createLocalizationWatchtowerPublicRoutes, createLocalizationWatchtowerRegistryRoutes, summarizeLocalizationWatchtowerFixtures } from '../packages/localization-watchtower/index.mjs';

test('localization-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLocalizationWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLocalizationWatchtowerDashboardRoutes().length, 3);
  assert.equal(createLocalizationWatchtowerApiRoutes().length, 4);
  assert.equal(createLocalizationWatchtowerOpsRoutes().length, 3);
  assert.equal(createLocalizationWatchtowerPublicRoutes().length, 3);
  assert.equal(createLocalizationWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLocalizationWatchtowerFixtures().contacts, 2);
});

