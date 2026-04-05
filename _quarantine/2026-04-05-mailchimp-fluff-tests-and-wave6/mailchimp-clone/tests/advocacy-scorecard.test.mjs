import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvocacyScorecardSnapshot, createAdvocacyScorecardDashboardRoutes, createAdvocacyScorecardApiRoutes, createAdvocacyScorecardOpsRoutes, createAdvocacyScorecardPublicRoutes, createAdvocacyScorecardRegistryRoutes, summarizeAdvocacyScorecardFixtures } from '../packages/advocacy-scorecard/index.mjs';

test('advocacy-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAdvocacyScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAdvocacyScorecardDashboardRoutes().length, 3);
  assert.equal(createAdvocacyScorecardApiRoutes().length, 4);
  assert.equal(createAdvocacyScorecardOpsRoutes().length, 3);
  assert.equal(createAdvocacyScorecardPublicRoutes().length, 3);
  assert.equal(createAdvocacyScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAdvocacyScorecardFixtures().contacts, 2);
});

