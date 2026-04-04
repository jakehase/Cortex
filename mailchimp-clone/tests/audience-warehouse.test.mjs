import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceWarehouseSnapshot, createAudienceWarehouseDashboardRoutes, createAudienceWarehouseApiRoutes, createAudienceWarehouseOpsRoutes, createAudienceWarehousePublicRoutes, summarizeAudienceWarehouseFixtures } from '../packages/audience-warehouse/index.mjs';

test('audience-warehouse package deepens continuation breadth and route catalogs', () => {
  const snapshot = buildAudienceWarehouseSnapshot('Continuation Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Continuation Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAudienceWarehouseDashboardRoutes().length, 3);
  assert.equal(createAudienceWarehouseApiRoutes().length, 3);
  assert.equal(createAudienceWarehouseOpsRoutes().length, 3);
  assert.equal(createAudienceWarehousePublicRoutes().length, 3);
  assert.equal(summarizeAudienceWarehouseFixtures().contacts, 2);
});
