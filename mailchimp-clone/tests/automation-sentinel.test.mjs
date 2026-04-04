import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomationSentinelSnapshot, createAutomationSentinelDashboardRoutes, createAutomationSentinelApiRoutes, createAutomationSentinelOpsRoutes, createAutomationSentinelPublicRoutes, createAutomationSentinelRegistryRoutes, summarizeAutomationSentinelFixtures } from '../packages/automation-sentinel/index.mjs';

test('automation-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAutomationSentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAutomationSentinelDashboardRoutes().length, 3);
  assert.equal(createAutomationSentinelApiRoutes().length, 4);
  assert.equal(createAutomationSentinelOpsRoutes().length, 3);
  assert.equal(createAutomationSentinelPublicRoutes().length, 3);
  assert.equal(createAutomationSentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAutomationSentinelFixtures().contacts, 2);
});

