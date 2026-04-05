import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomationScorecardSnapshot, createAutomationScorecardDashboardRoutes, createAutomationScorecardApiRoutes, createAutomationScorecardOpsRoutes, createAutomationScorecardPublicRoutes, createAutomationScorecardRegistryRoutes, summarizeAutomationScorecardFixtures } from '../packages/automation-scorecard/index.mjs';

test('automation-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAutomationScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAutomationScorecardDashboardRoutes().length, 3);
  assert.equal(createAutomationScorecardApiRoutes().length, 4);
  assert.equal(createAutomationScorecardOpsRoutes().length, 3);
  assert.equal(createAutomationScorecardPublicRoutes().length, 3);
  assert.equal(createAutomationScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAutomationScorecardFixtures().contacts, 2);
});

