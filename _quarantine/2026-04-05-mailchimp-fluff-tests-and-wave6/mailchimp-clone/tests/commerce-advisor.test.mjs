import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommerceAdvisorSnapshot, createCommerceAdvisorDashboardRoutes, createCommerceAdvisorApiRoutes, createCommerceAdvisorOpsRoutes, createCommerceAdvisorPublicRoutes, createCommerceAdvisorRegistryRoutes, summarizeCommerceAdvisorFixtures } from '../packages/commerce-advisor/index.mjs';

test('commerce-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCommerceAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCommerceAdvisorDashboardRoutes().length, 3);
  assert.equal(createCommerceAdvisorApiRoutes().length, 4);
  assert.equal(createCommerceAdvisorOpsRoutes().length, 3);
  assert.equal(createCommerceAdvisorPublicRoutes().length, 3);
  assert.equal(createCommerceAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCommerceAdvisorFixtures().contacts, 2);
});

