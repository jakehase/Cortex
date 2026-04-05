import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelWatchtowerSnapshot, createChannelWatchtowerDashboardRoutes, createChannelWatchtowerApiRoutes, createChannelWatchtowerOpsRoutes, createChannelWatchtowerPublicRoutes, createChannelWatchtowerRegistryRoutes, summarizeChannelWatchtowerFixtures } from '../packages/channel-watchtower/index.mjs';

test('channel-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildChannelWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createChannelWatchtowerDashboardRoutes().length, 3);
  assert.equal(createChannelWatchtowerApiRoutes().length, 4);
  assert.equal(createChannelWatchtowerOpsRoutes().length, 3);
  assert.equal(createChannelWatchtowerPublicRoutes().length, 3);
  assert.equal(createChannelWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeChannelWatchtowerFixtures().contacts, 2);
});

