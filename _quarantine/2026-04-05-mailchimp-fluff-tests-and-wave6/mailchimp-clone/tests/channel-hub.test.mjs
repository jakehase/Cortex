import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelHubSnapshot, createChannelHubDashboardRoutes, createChannelHubApiRoutes, createChannelHubOpsRoutes, createChannelHubPublicRoutes, createChannelHubRegistryRoutes, summarizeChannelHubFixtures } from '../packages/channel-hub/index.mjs';

test('channel-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildChannelHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createChannelHubDashboardRoutes().length, 3);
  assert.equal(createChannelHubApiRoutes().length, 4);
  assert.equal(createChannelHubOpsRoutes().length, 3);
  assert.equal(createChannelHubPublicRoutes().length, 3);
  assert.equal(createChannelHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeChannelHubFixtures().contacts, 2);
});

