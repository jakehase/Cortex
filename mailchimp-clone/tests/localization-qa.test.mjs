import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalizationQaSnapshot, createLocalizationQaDashboardRoutes, createLocalizationQaApiRoutes, createLocalizationQaOpsRoutes, createLocalizationQaPublicRoutes, summarizeLocalizationQaFixtures } from '../packages/localization-qa/index.mjs';

test('localization-qa package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildLocalizationQaSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLocalizationQaDashboardRoutes().length, 3);
  assert.equal(createLocalizationQaApiRoutes().length, 3);
  assert.equal(createLocalizationQaOpsRoutes().length, 3);
  assert.equal(createLocalizationQaPublicRoutes().length, 3);
  assert.equal(summarizeLocalizationQaFixtures().contacts, 2);
});

