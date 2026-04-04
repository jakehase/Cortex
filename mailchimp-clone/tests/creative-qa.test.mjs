import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativeQaSnapshot, createCreativeQaDashboardRoutes, createCreativeQaApiRoutes, createCreativeQaOpsRoutes, createCreativeQaPublicRoutes, summarizeCreativeQaFixtures } from '../packages/creative-qa/index.mjs';

test('creative-qa package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildCreativeQaSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCreativeQaDashboardRoutes().length, 3);
  assert.equal(createCreativeQaApiRoutes().length, 3);
  assert.equal(createCreativeQaOpsRoutes().length, 3);
  assert.equal(createCreativeQaPublicRoutes().length, 3);
  assert.equal(summarizeCreativeQaFixtures().contacts, 2);
});

