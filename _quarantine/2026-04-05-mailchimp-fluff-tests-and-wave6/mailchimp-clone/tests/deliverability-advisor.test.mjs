import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliverabilityAdvisorSnapshot, createDeliverabilityAdvisorDashboardRoutes, createDeliverabilityAdvisorApiRoutes, createDeliverabilityAdvisorOpsRoutes, createDeliverabilityAdvisorPublicRoutes, createDeliverabilityAdvisorRegistryRoutes, summarizeDeliverabilityAdvisorFixtures } from '../packages/deliverability-advisor/index.mjs';

test('deliverability-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDeliverabilityAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDeliverabilityAdvisorDashboardRoutes().length, 3);
  assert.equal(createDeliverabilityAdvisorApiRoutes().length, 4);
  assert.equal(createDeliverabilityAdvisorOpsRoutes().length, 3);
  assert.equal(createDeliverabilityAdvisorPublicRoutes().length, 3);
  assert.equal(createDeliverabilityAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDeliverabilityAdvisorFixtures().contacts, 2);
});

