import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRetentionOffersSnapshot, createRetentionOffersDashboardRoutes, createRetentionOffersApiRoutes, createRetentionOffersOpsRoutes, createRetentionOffersPublicRoutes, summarizeRetentionOffersFixtures } from '../packages/retention-offers/index.mjs';

test('retention-offers package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildRetentionOffersSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createRetentionOffersDashboardRoutes().length, 3);
  assert.equal(createRetentionOffersApiRoutes().length, 3);
  assert.equal(createRetentionOffersOpsRoutes().length, 3);
  assert.equal(createRetentionOffersPublicRoutes().length, 3);
  assert.equal(summarizeRetentionOffersFixtures().contacts, 2);
});

