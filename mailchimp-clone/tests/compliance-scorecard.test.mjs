import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceScorecardSnapshot, createComplianceScorecardDashboardRoutes, createComplianceScorecardApiRoutes, createComplianceScorecardOpsRoutes, createComplianceScorecardPublicRoutes, createComplianceScorecardRegistryRoutes, summarizeComplianceScorecardFixtures } from '../packages/compliance-scorecard/index.mjs';

test('compliance-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildComplianceScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createComplianceScorecardDashboardRoutes().length, 3);
  assert.equal(createComplianceScorecardApiRoutes().length, 4);
  assert.equal(createComplianceScorecardOpsRoutes().length, 3);
  assert.equal(createComplianceScorecardPublicRoutes().length, 3);
  assert.equal(createComplianceScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeComplianceScorecardFixtures().contacts, 2);
});

