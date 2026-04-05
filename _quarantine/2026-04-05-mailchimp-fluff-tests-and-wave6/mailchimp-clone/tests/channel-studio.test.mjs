import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelStudioSnapshot, createChannelStudioDashboardRoutes, createChannelStudioApiRoutes, createChannelStudioOpsRoutes, createChannelStudioPublicRoutes, createChannelStudioRegistryRoutes, summarizeChannelStudioFixtures } from '../packages/channel-studio/index.mjs';

test('channel-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildChannelStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createChannelStudioDashboardRoutes().length, 3);
  assert.equal(createChannelStudioApiRoutes().length, 4);
  assert.equal(createChannelStudioOpsRoutes().length, 3);
  assert.equal(createChannelStudioPublicRoutes().length, 3);
  assert.equal(createChannelStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeChannelStudioFixtures().contacts, 2);
});

