import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommerceFoundrySnapshot, createCommerceFoundryDashboardRoutes, createCommerceFoundryApiRoutes, createCommerceFoundryOpsRoutes, createCommerceFoundryPublicRoutes, createCommerceFoundryRegistryRoutes, summarizeCommerceFoundryFixtures } from '../packages/commerce-foundry/index.mjs';

test('commerce-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCommerceFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCommerceFoundryDashboardRoutes().length, 3);
  assert.equal(createCommerceFoundryApiRoutes().length, 4);
  assert.equal(createCommerceFoundryOpsRoutes().length, 3);
  assert.equal(createCommerceFoundryPublicRoutes().length, 3);
  assert.equal(createCommerceFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCommerceFoundryFixtures().contacts, 2);
});

