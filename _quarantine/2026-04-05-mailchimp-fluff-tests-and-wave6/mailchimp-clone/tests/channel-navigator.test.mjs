import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelNavigatorSnapshot, createChannelNavigatorDashboardRoutes, createChannelNavigatorApiRoutes, createChannelNavigatorOpsRoutes, createChannelNavigatorPublicRoutes, createChannelNavigatorRegistryRoutes, summarizeChannelNavigatorFixtures } from '../packages/channel-navigator/index.mjs';

test('channel-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildChannelNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createChannelNavigatorDashboardRoutes().length, 3);
  assert.equal(createChannelNavigatorApiRoutes().length, 4);
  assert.equal(createChannelNavigatorOpsRoutes().length, 3);
  assert.equal(createChannelNavigatorPublicRoutes().length, 3);
  assert.equal(createChannelNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeChannelNavigatorFixtures().contacts, 2);
});

