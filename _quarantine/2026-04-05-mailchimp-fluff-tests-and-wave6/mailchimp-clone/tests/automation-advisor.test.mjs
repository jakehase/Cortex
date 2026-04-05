import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomationAdvisorSnapshot, createAutomationAdvisorDashboardRoutes, createAutomationAdvisorApiRoutes, createAutomationAdvisorOpsRoutes, createAutomationAdvisorPublicRoutes, createAutomationAdvisorRegistryRoutes, summarizeAutomationAdvisorFixtures } from '../packages/automation-advisor/index.mjs';

test('automation-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAutomationAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAutomationAdvisorDashboardRoutes().length, 3);
  assert.equal(createAutomationAdvisorApiRoutes().length, 4);
  assert.equal(createAutomationAdvisorOpsRoutes().length, 3);
  assert.equal(createAutomationAdvisorPublicRoutes().length, 3);
  assert.equal(createAutomationAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAutomationAdvisorFixtures().contacts, 2);
});

