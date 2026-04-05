import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommerceIndexSnapshot, createCommerceIndexDashboardRoutes, createCommerceIndexApiRoutes, createCommerceIndexOpsRoutes, createCommerceIndexPublicRoutes, createCommerceIndexRegistryRoutes, summarizeCommerceIndexFixtures } from '../packages/commerce-index/index.mjs';

test('commerce-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCommerceIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCommerceIndexDashboardRoutes().length, 3);
  assert.equal(createCommerceIndexApiRoutes().length, 4);
  assert.equal(createCommerceIndexOpsRoutes().length, 3);
  assert.equal(createCommerceIndexPublicRoutes().length, 3);
  assert.equal(createCommerceIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCommerceIndexFixtures().contacts, 2);
});

