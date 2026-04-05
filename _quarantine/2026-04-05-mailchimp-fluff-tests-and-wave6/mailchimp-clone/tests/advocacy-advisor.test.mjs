import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvocacyAdvisorSnapshot, createAdvocacyAdvisorDashboardRoutes, createAdvocacyAdvisorApiRoutes, createAdvocacyAdvisorOpsRoutes, createAdvocacyAdvisorPublicRoutes, createAdvocacyAdvisorRegistryRoutes, summarizeAdvocacyAdvisorFixtures } from '../packages/advocacy-advisor/index.mjs';

test('advocacy-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAdvocacyAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAdvocacyAdvisorDashboardRoutes().length, 3);
  assert.equal(createAdvocacyAdvisorApiRoutes().length, 4);
  assert.equal(createAdvocacyAdvisorOpsRoutes().length, 3);
  assert.equal(createAdvocacyAdvisorPublicRoutes().length, 3);
  assert.equal(createAdvocacyAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAdvocacyAdvisorFixtures().contacts, 2);
});

