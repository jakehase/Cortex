import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCouponStudioSnapshot, createCouponStudioDashboardRoutes, createCouponStudioApiRoutes, createCouponStudioOpsRoutes, createCouponStudioPublicRoutes, summarizeCouponStudioFixtures } from '../packages/coupon-studio/index.mjs';

test('coupon-studio package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildCouponStudioSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCouponStudioDashboardRoutes().length, 3);
  assert.equal(createCouponStudioApiRoutes().length, 3);
  assert.equal(createCouponStudioOpsRoutes().length, 3);
  assert.equal(createCouponStudioPublicRoutes().length, 3);
  assert.equal(summarizeCouponStudioFixtures().contacts, 2);
});
