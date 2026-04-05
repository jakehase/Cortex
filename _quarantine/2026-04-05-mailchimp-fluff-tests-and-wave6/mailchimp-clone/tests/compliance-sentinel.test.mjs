import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceSentinelSnapshot, createComplianceSentinelDashboardRoutes, createComplianceSentinelApiRoutes, createComplianceSentinelOpsRoutes, createComplianceSentinelPublicRoutes, createComplianceSentinelRegistryRoutes, summarizeComplianceSentinelFixtures } from '../packages/compliance-sentinel/index.mjs';

test('compliance-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildComplianceSentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createComplianceSentinelDashboardRoutes().length, 3);
  assert.equal(createComplianceSentinelApiRoutes().length, 4);
  assert.equal(createComplianceSentinelOpsRoutes().length, 3);
  assert.equal(createComplianceSentinelPublicRoutes().length, 3);
  assert.equal(createComplianceSentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeComplianceSentinelFixtures().contacts, 2);
});

