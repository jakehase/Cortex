import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributionScorecardSnapshot, createAttributionScorecardDashboardRoutes, createAttributionScorecardApiRoutes, createAttributionScorecardOpsRoutes, createAttributionScorecardPublicRoutes, createAttributionScorecardRegistryRoutes, summarizeAttributionScorecardFixtures } from '../packages/attribution-scorecard/index.mjs';

test('attribution-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAttributionScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAttributionScorecardDashboardRoutes().length, 3);
  assert.equal(createAttributionScorecardApiRoutes().length, 4);
  assert.equal(createAttributionScorecardOpsRoutes().length, 3);
  assert.equal(createAttributionScorecardPublicRoutes().length, 3);
  assert.equal(createAttributionScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAttributionScorecardFixtures().contacts, 2);
});

