import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcquisitionAdvisorSnapshot, createAcquisitionAdvisorDashboardRoutes, createAcquisitionAdvisorApiRoutes, createAcquisitionAdvisorOpsRoutes, createAcquisitionAdvisorPublicRoutes, createAcquisitionAdvisorRegistryRoutes, summarizeAcquisitionAdvisorFixtures } from '../packages/acquisition-advisor/index.mjs';

test('acquisition-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAcquisitionAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAcquisitionAdvisorDashboardRoutes().length, 3);
  assert.equal(createAcquisitionAdvisorApiRoutes().length, 4);
  assert.equal(createAcquisitionAdvisorOpsRoutes().length, 3);
  assert.equal(createAcquisitionAdvisorPublicRoutes().length, 3);
  assert.equal(createAcquisitionAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAcquisitionAdvisorFixtures().contacts, 2);
});

