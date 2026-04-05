import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativeAdvisorSnapshot, createCreativeAdvisorDashboardRoutes, createCreativeAdvisorApiRoutes, createCreativeAdvisorOpsRoutes, createCreativeAdvisorPublicRoutes, createCreativeAdvisorRegistryRoutes, summarizeCreativeAdvisorFixtures } from '../packages/creative-advisor/index.mjs';

test('creative-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCreativeAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCreativeAdvisorDashboardRoutes().length, 3);
  assert.equal(createCreativeAdvisorApiRoutes().length, 4);
  assert.equal(createCreativeAdvisorOpsRoutes().length, 3);
  assert.equal(createCreativeAdvisorPublicRoutes().length, 3);
  assert.equal(createCreativeAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCreativeAdvisorFixtures().contacts, 2);
});

