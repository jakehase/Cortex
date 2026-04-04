import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceNavigatorSnapshot, createComplianceNavigatorDashboardRoutes, createComplianceNavigatorApiRoutes, createComplianceNavigatorOpsRoutes, createComplianceNavigatorPublicRoutes, createComplianceNavigatorRegistryRoutes, summarizeComplianceNavigatorFixtures } from '../packages/compliance-navigator/index.mjs';

test('compliance-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildComplianceNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createComplianceNavigatorDashboardRoutes().length, 3);
  assert.equal(createComplianceNavigatorApiRoutes().length, 4);
  assert.equal(createComplianceNavigatorOpsRoutes().length, 3);
  assert.equal(createComplianceNavigatorPublicRoutes().length, 3);
  assert.equal(createComplianceNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeComplianceNavigatorFixtures().contacts, 2);
});

