import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomationExchangeSnapshot, createAutomationExchangeDashboardRoutes, createAutomationExchangeApiRoutes, createAutomationExchangeOpsRoutes, createAutomationExchangePublicRoutes, createAutomationExchangeRegistryRoutes, summarizeAutomationExchangeFixtures } from '../packages/automation-exchange/index.mjs';

test('automation-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAutomationExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAutomationExchangeDashboardRoutes().length, 3);
  assert.equal(createAutomationExchangeApiRoutes().length, 4);
  assert.equal(createAutomationExchangeOpsRoutes().length, 3);
  assert.equal(createAutomationExchangePublicRoutes().length, 3);
  assert.equal(createAutomationExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAutomationExchangeFixtures().contacts, 2);
});

