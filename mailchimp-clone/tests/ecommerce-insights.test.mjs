import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEcommerceInsightsSnapshot, createEcommerceInsightsDashboardRoutes, createEcommerceInsightsApiRoutes, createEcommerceInsightsOpsRoutes, createEcommerceInsightsPublicRoutes, summarizeEcommerceInsightsFixtures } from '../packages/ecommerce-insights/index.mjs';

test('ecommerce-insights package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildEcommerceInsightsSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createEcommerceInsightsDashboardRoutes().length, 3);
  assert.equal(createEcommerceInsightsApiRoutes().length, 3);
  assert.equal(createEcommerceInsightsOpsRoutes().length, 3);
  assert.equal(createEcommerceInsightsPublicRoutes().length, 3);
  assert.equal(summarizeEcommerceInsightsFixtures().contacts, 2);
});

