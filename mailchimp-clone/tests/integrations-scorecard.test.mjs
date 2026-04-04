import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegrationsScorecardSnapshot, createIntegrationsScorecardDashboardRoutes, createIntegrationsScorecardApiRoutes, createIntegrationsScorecardOpsRoutes, createIntegrationsScorecardPublicRoutes, createIntegrationsScorecardRegistryRoutes, summarizeIntegrationsScorecardFixtures } from '../packages/integrations-scorecard/index.mjs';

test('integrations-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildIntegrationsScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createIntegrationsScorecardDashboardRoutes().length, 3);
  assert.equal(createIntegrationsScorecardApiRoutes().length, 4);
  assert.equal(createIntegrationsScorecardOpsRoutes().length, 3);
  assert.equal(createIntegrationsScorecardPublicRoutes().length, 3);
  assert.equal(createIntegrationsScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeIntegrationsScorecardFixtures().contacts, 2);
});

