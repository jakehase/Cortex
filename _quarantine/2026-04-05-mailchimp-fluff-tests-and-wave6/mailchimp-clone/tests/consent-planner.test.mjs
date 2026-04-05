import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConsentPlannerSnapshot, createConsentPlannerDashboardRoutes, createConsentPlannerApiRoutes, createConsentPlannerOpsRoutes, createConsentPlannerPublicRoutes, createConsentPlannerRegistryRoutes, summarizeConsentPlannerFixtures } from '../packages/consent-planner/index.mjs';

test('consent-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildConsentPlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createConsentPlannerDashboardRoutes().length, 3);
  assert.equal(createConsentPlannerApiRoutes().length, 4);
  assert.equal(createConsentPlannerOpsRoutes().length, 3);
  assert.equal(createConsentPlannerPublicRoutes().length, 3);
  assert.equal(createConsentPlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeConsentPlannerFixtures().contacts, 2);
});

