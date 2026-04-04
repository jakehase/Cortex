import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommerceCouponsSnapshot, createCommerceCouponsDashboardRoutes, createCommerceCouponsApiRoutes, createCommerceCouponsOpsRoutes, createCommerceCouponsPublicRoutes, summarizeCommerceCouponsFixtures } from '../packages/commerce-coupons/index.mjs';

test('commerce-coupons package deepens continuation breadth and route catalogs', () => {
  const snapshot = buildCommerceCouponsSnapshot('Continuation Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Continuation Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCommerceCouponsDashboardRoutes().length, 3);
  assert.equal(createCommerceCouponsApiRoutes().length, 3);
  assert.equal(createCommerceCouponsOpsRoutes().length, 3);
  assert.equal(createCommerceCouponsPublicRoutes().length, 3);
  assert.equal(summarizeCommerceCouponsFixtures().contacts, 2);
});
