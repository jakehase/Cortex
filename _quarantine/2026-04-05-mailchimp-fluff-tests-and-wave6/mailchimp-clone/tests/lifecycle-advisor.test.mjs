import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLifecycleAdvisorSnapshot, createLifecycleAdvisorDashboardRoutes, createLifecycleAdvisorApiRoutes, createLifecycleAdvisorOpsRoutes, createLifecycleAdvisorPublicRoutes, createLifecycleAdvisorRegistryRoutes, summarizeLifecycleAdvisorFixtures } from '../packages/lifecycle-advisor/index.mjs';

test('lifecycle-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLifecycleAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLifecycleAdvisorDashboardRoutes().length, 3);
  assert.equal(createLifecycleAdvisorApiRoutes().length, 4);
  assert.equal(createLifecycleAdvisorOpsRoutes().length, 3);
  assert.equal(createLifecycleAdvisorPublicRoutes().length, 3);
  assert.equal(createLifecycleAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLifecycleAdvisorFixtures().contacts, 2);
});

