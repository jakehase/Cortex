import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommerceGridSnapshot, createCommerceGridDashboardRoutes, createCommerceGridApiRoutes, createCommerceGridOpsRoutes, createCommerceGridPublicRoutes, createCommerceGridRegistryRoutes, summarizeCommerceGridFixtures } from '../packages/commerce-grid/index.mjs';

test('commerce-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCommerceGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCommerceGridDashboardRoutes().length, 3);
  assert.equal(createCommerceGridApiRoutes().length, 4);
  assert.equal(createCommerceGridOpsRoutes().length, 3);
  assert.equal(createCommerceGridPublicRoutes().length, 3);
  assert.equal(createCommerceGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCommerceGridFixtures().contacts, 2);
});

