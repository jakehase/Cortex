import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelScorecardSnapshot, createChannelScorecardDashboardRoutes, createChannelScorecardApiRoutes, createChannelScorecardOpsRoutes, createChannelScorecardPublicRoutes, createChannelScorecardRegistryRoutes, summarizeChannelScorecardFixtures } from '../packages/channel-scorecard/index.mjs';

test('channel-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildChannelScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createChannelScorecardDashboardRoutes().length, 3);
  assert.equal(createChannelScorecardApiRoutes().length, 4);
  assert.equal(createChannelScorecardOpsRoutes().length, 3);
  assert.equal(createChannelScorecardPublicRoutes().length, 3);
  assert.equal(createChannelScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeChannelScorecardFixtures().contacts, 2);
});

