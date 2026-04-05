import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudiencePlannerSnapshot, createAudiencePlannerDashboardRoutes, createAudiencePlannerApiRoutes, createAudiencePlannerOpsRoutes, createAudiencePlannerPublicRoutes, createAudiencePlannerRegistryRoutes, summarizeAudiencePlannerFixtures } from '../packages/audience-planner/index.mjs';

test('audience-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAudiencePlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAudiencePlannerDashboardRoutes().length, 3);
  assert.equal(createAudiencePlannerApiRoutes().length, 4);
  assert.equal(createAudiencePlannerOpsRoutes().length, 3);
  assert.equal(createAudiencePlannerPublicRoutes().length, 3);
  assert.equal(createAudiencePlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAudiencePlannerFixtures().contacts, 2);
});

