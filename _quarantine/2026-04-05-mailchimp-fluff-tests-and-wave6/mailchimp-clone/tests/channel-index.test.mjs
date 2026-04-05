import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelIndexSnapshot, createChannelIndexDashboardRoutes, createChannelIndexApiRoutes, createChannelIndexOpsRoutes, createChannelIndexPublicRoutes, createChannelIndexRegistryRoutes, summarizeChannelIndexFixtures } from '../packages/channel-index/index.mjs';

test('channel-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildChannelIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createChannelIndexDashboardRoutes().length, 3);
  assert.equal(createChannelIndexApiRoutes().length, 4);
  assert.equal(createChannelIndexOpsRoutes().length, 3);
  assert.equal(createChannelIndexPublicRoutes().length, 3);
  assert.equal(createChannelIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeChannelIndexFixtures().contacts, 2);
});

