import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommerceStudioSnapshot, createCommerceStudioDashboardRoutes, createCommerceStudioApiRoutes, createCommerceStudioOpsRoutes, createCommerceStudioPublicRoutes, createCommerceStudioRegistryRoutes, summarizeCommerceStudioFixtures } from '../packages/commerce-studio/index.mjs';

test('commerce-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCommerceStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCommerceStudioDashboardRoutes().length, 3);
  assert.equal(createCommerceStudioApiRoutes().length, 4);
  assert.equal(createCommerceStudioOpsRoutes().length, 3);
  assert.equal(createCommerceStudioPublicRoutes().length, 3);
  assert.equal(createCommerceStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCommerceStudioFixtures().contacts, 2);
});

