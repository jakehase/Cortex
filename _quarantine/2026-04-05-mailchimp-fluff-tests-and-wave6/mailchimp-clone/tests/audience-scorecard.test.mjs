import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceScorecardSnapshot, createAudienceScorecardDashboardRoutes, createAudienceScorecardApiRoutes, createAudienceScorecardOpsRoutes, createAudienceScorecardPublicRoutes, createAudienceScorecardRegistryRoutes, summarizeAudienceScorecardFixtures } from '../packages/audience-scorecard/index.mjs';

test('audience-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAudienceScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAudienceScorecardDashboardRoutes().length, 3);
  assert.equal(createAudienceScorecardApiRoutes().length, 4);
  assert.equal(createAudienceScorecardOpsRoutes().length, 3);
  assert.equal(createAudienceScorecardPublicRoutes().length, 3);
  assert.equal(createAudienceScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAudienceScorecardFixtures().contacts, 2);
});

