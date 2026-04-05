import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoyaltyAdvisorSnapshot, createLoyaltyAdvisorDashboardRoutes, createLoyaltyAdvisorApiRoutes, createLoyaltyAdvisorOpsRoutes, createLoyaltyAdvisorPublicRoutes, createLoyaltyAdvisorRegistryRoutes, summarizeLoyaltyAdvisorFixtures } from '../packages/loyalty-advisor/index.mjs';

test('loyalty-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLoyaltyAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLoyaltyAdvisorDashboardRoutes().length, 3);
  assert.equal(createLoyaltyAdvisorApiRoutes().length, 4);
  assert.equal(createLoyaltyAdvisorOpsRoutes().length, 3);
  assert.equal(createLoyaltyAdvisorPublicRoutes().length, 3);
  assert.equal(createLoyaltyAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLoyaltyAdvisorFixtures().contacts, 2);
});

