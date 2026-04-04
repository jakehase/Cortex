import test from 'node:test';
import assert from 'node:assert/strict';
import { createRetentionOffersDashboardRoutes, createRetentionOffersApiRoutes, createRetentionOffersOpsRoutes, createRetentionOffersPublicRoutes } from '../packages/retention-offers/index.mjs';

test('retention-offers routes honor custom base paths and stable ids', () => {
  const dashboard = createRetentionOffersDashboardRoutes('/labs/retention-offers');
  const api = createRetentionOffersApiRoutes('/api/labs/retention-offers');
  const ops = createRetentionOffersOpsRoutes('/ops/labs/retention-offers');
  const pub = createRetentionOffersPublicRoutes('/public/labs/retention-offers');
  assert.equal(dashboard[0].path, '/labs/retention-offers');
  assert.equal(api[0].path, '/api/labs/retention-offers/overview');
  assert.equal(ops[0].path, '/ops/labs/retention-offers/health');
  assert.equal(pub[0].path, '/public/labs/retention-offers');
  assert.match(dashboard[0].id, /retention\-offers/);
  assert.match(api[2].id, /retention\-offers/);
});

