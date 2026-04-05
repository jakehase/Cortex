import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalizationGridSnapshot, createLocalizationGridDashboardRoutes, createLocalizationGridApiRoutes, createLocalizationGridOpsRoutes, createLocalizationGridPublicRoutes, createLocalizationGridRegistryRoutes, summarizeLocalizationGridFixtures } from '../packages/localization-grid/index.mjs';

test('localization-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLocalizationGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLocalizationGridDashboardRoutes().length, 3);
  assert.equal(createLocalizationGridApiRoutes().length, 4);
  assert.equal(createLocalizationGridOpsRoutes().length, 3);
  assert.equal(createLocalizationGridPublicRoutes().length, 3);
  assert.equal(createLocalizationGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLocalizationGridFixtures().contacts, 2);
});

