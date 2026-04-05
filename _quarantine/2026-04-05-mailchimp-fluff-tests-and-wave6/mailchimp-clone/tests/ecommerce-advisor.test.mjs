import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEcommerceAdvisorSnapshot, createEcommerceAdvisorDashboardRoutes, createEcommerceAdvisorApiRoutes, createEcommerceAdvisorOpsRoutes, createEcommerceAdvisorPublicRoutes, createEcommerceAdvisorRegistryRoutes, summarizeEcommerceAdvisorFixtures } from '../packages/ecommerce-advisor/index.mjs';

test('ecommerce-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildEcommerceAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createEcommerceAdvisorDashboardRoutes().length, 3);
  assert.equal(createEcommerceAdvisorApiRoutes().length, 4);
  assert.equal(createEcommerceAdvisorOpsRoutes().length, 3);
  assert.equal(createEcommerceAdvisorPublicRoutes().length, 3);
  assert.equal(createEcommerceAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeEcommerceAdvisorFixtures().contacts, 2);
});

