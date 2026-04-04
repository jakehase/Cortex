import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceWatchtowerSnapshot, createComplianceWatchtowerDashboardRoutes, createComplianceWatchtowerApiRoutes, createComplianceWatchtowerOpsRoutes, createComplianceWatchtowerPublicRoutes, createComplianceWatchtowerRegistryRoutes, summarizeComplianceWatchtowerFixtures } from '../packages/compliance-watchtower/index.mjs';

test('compliance-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildComplianceWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createComplianceWatchtowerDashboardRoutes().length, 3);
  assert.equal(createComplianceWatchtowerApiRoutes().length, 4);
  assert.equal(createComplianceWatchtowerOpsRoutes().length, 3);
  assert.equal(createComplianceWatchtowerPublicRoutes().length, 3);
  assert.equal(createComplianceWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeComplianceWatchtowerFixtures().contacts, 2);
});

