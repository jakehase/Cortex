import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEcommercePlannerSnapshot, createEcommercePlannerDashboardRoutes, createEcommercePlannerApiRoutes, createEcommercePlannerOpsRoutes, createEcommercePlannerPublicRoutes, createEcommercePlannerRegistryRoutes, summarizeEcommercePlannerFixtures } from '../packages/ecommerce-planner/index.mjs';

test('ecommerce-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildEcommercePlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createEcommercePlannerDashboardRoutes().length, 3);
  assert.equal(createEcommercePlannerApiRoutes().length, 4);
  assert.equal(createEcommercePlannerOpsRoutes().length, 3);
  assert.equal(createEcommercePlannerPublicRoutes().length, 3);
  assert.equal(createEcommercePlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeEcommercePlannerFixtures().contacts, 2);
});

