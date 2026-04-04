import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplateMarketplaceSnapshot, createTemplateMarketplaceDashboardRoutes, createTemplateMarketplaceApiRoutes, createTemplateMarketplaceOpsRoutes, createTemplateMarketplacePublicRoutes, summarizeTemplateMarketplaceFixtures } from '../packages/template-marketplace/index.mjs';

test('template-marketplace package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildTemplateMarketplaceSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createTemplateMarketplaceDashboardRoutes().length, 3);
  assert.equal(createTemplateMarketplaceApiRoutes().length, 3);
  assert.equal(createTemplateMarketplaceOpsRoutes().length, 3);
  assert.equal(createTemplateMarketplacePublicRoutes().length, 3);
  assert.equal(summarizeTemplateMarketplaceFixtures().contacts, 2);
});
