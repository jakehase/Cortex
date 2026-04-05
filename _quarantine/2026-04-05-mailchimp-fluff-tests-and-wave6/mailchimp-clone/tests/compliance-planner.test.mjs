import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompliancePlannerSnapshot, createCompliancePlannerDashboardRoutes, createCompliancePlannerApiRoutes, createCompliancePlannerOpsRoutes, createCompliancePlannerPublicRoutes, createCompliancePlannerRegistryRoutes, summarizeCompliancePlannerFixtures } from '../packages/compliance-planner/index.mjs';

test('compliance-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCompliancePlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCompliancePlannerDashboardRoutes().length, 3);
  assert.equal(createCompliancePlannerApiRoutes().length, 4);
  assert.equal(createCompliancePlannerOpsRoutes().length, 3);
  assert.equal(createCompliancePlannerPublicRoutes().length, 3);
  assert.equal(createCompliancePlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCompliancePlannerFixtures().contacts, 2);
});

