import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataAdvisorSnapshot, createDataAdvisorDashboardRoutes, createDataAdvisorApiRoutes, createDataAdvisorOpsRoutes, createDataAdvisorPublicRoutes, createDataAdvisorRegistryRoutes, summarizeDataAdvisorFixtures } from '../packages/data-advisor/index.mjs';

test('data-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDataAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDataAdvisorDashboardRoutes().length, 3);
  assert.equal(createDataAdvisorApiRoutes().length, 4);
  assert.equal(createDataAdvisorOpsRoutes().length, 3);
  assert.equal(createDataAdvisorPublicRoutes().length, 3);
  assert.equal(createDataAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDataAdvisorFixtures().contacts, 2);
});

