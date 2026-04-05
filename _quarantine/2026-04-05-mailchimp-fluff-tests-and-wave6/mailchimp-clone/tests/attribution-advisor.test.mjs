import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributionAdvisorSnapshot, createAttributionAdvisorDashboardRoutes, createAttributionAdvisorApiRoutes, createAttributionAdvisorOpsRoutes, createAttributionAdvisorPublicRoutes, createAttributionAdvisorRegistryRoutes, summarizeAttributionAdvisorFixtures } from '../packages/attribution-advisor/index.mjs';

test('attribution-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAttributionAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAttributionAdvisorDashboardRoutes().length, 3);
  assert.equal(createAttributionAdvisorApiRoutes().length, 4);
  assert.equal(createAttributionAdvisorOpsRoutes().length, 3);
  assert.equal(createAttributionAdvisorPublicRoutes().length, 3);
  assert.equal(createAttributionAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAttributionAdvisorFixtures().contacts, 2);
});

