import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceAdvisorSnapshot, createAudienceAdvisorDashboardRoutes, createAudienceAdvisorApiRoutes, createAudienceAdvisorOpsRoutes, createAudienceAdvisorPublicRoutes, createAudienceAdvisorRegistryRoutes, summarizeAudienceAdvisorFixtures } from '../packages/audience-advisor/index.mjs';

test('audience-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAudienceAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAudienceAdvisorDashboardRoutes().length, 3);
  assert.equal(createAudienceAdvisorApiRoutes().length, 4);
  assert.equal(createAudienceAdvisorOpsRoutes().length, 3);
  assert.equal(createAudienceAdvisorPublicRoutes().length, 3);
  assert.equal(createAudienceAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAudienceAdvisorFixtures().contacts, 2);
});

