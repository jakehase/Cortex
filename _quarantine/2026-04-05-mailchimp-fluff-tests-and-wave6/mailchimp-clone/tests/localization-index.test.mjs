import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalizationIndexSnapshot, createLocalizationIndexDashboardRoutes, createLocalizationIndexApiRoutes, createLocalizationIndexOpsRoutes, createLocalizationIndexPublicRoutes, createLocalizationIndexRegistryRoutes, summarizeLocalizationIndexFixtures } from '../packages/localization-index/index.mjs';

test('localization-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLocalizationIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLocalizationIndexDashboardRoutes().length, 3);
  assert.equal(createLocalizationIndexApiRoutes().length, 4);
  assert.equal(createLocalizationIndexOpsRoutes().length, 3);
  assert.equal(createLocalizationIndexPublicRoutes().length, 3);
  assert.equal(createLocalizationIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLocalizationIndexFixtures().contacts, 2);
});

