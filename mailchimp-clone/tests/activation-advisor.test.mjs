import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivationAdvisorSnapshot, createActivationAdvisorDashboardRoutes, createActivationAdvisorApiRoutes, createActivationAdvisorOpsRoutes, createActivationAdvisorPublicRoutes, createActivationAdvisorRegistryRoutes, summarizeActivationAdvisorFixtures } from '../packages/activation-advisor/index.mjs';

test('activation-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildActivationAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createActivationAdvisorDashboardRoutes().length, 3);
  assert.equal(createActivationAdvisorApiRoutes().length, 4);
  assert.equal(createActivationAdvisorOpsRoutes().length, 3);
  assert.equal(createActivationAdvisorPublicRoutes().length, 3);
  assert.equal(createActivationAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeActivationAdvisorFixtures().contacts, 2);
});

