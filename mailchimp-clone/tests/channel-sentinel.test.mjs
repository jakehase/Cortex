import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelSentinelSnapshot, createChannelSentinelDashboardRoutes, createChannelSentinelApiRoutes, createChannelSentinelOpsRoutes, createChannelSentinelPublicRoutes, createChannelSentinelRegistryRoutes, summarizeChannelSentinelFixtures } from '../packages/channel-sentinel/index.mjs';

test('channel-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildChannelSentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createChannelSentinelDashboardRoutes().length, 3);
  assert.equal(createChannelSentinelApiRoutes().length, 4);
  assert.equal(createChannelSentinelOpsRoutes().length, 3);
  assert.equal(createChannelSentinelPublicRoutes().length, 3);
  assert.equal(createChannelSentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeChannelSentinelFixtures().contacts, 2);
});

