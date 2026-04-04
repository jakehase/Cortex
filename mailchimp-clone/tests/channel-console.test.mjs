import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelConsoleSnapshot, createChannelConsoleDashboardRoutes, createChannelConsoleApiRoutes, createChannelConsoleOpsRoutes, createChannelConsolePublicRoutes, createChannelConsoleRegistryRoutes, summarizeChannelConsoleFixtures } from '../packages/channel-console/index.mjs';

test('channel-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildChannelConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createChannelConsoleDashboardRoutes().length, 3);
  assert.equal(createChannelConsoleApiRoutes().length, 4);
  assert.equal(createChannelConsoleOpsRoutes().length, 3);
  assert.equal(createChannelConsolePublicRoutes().length, 3);
  assert.equal(createChannelConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeChannelConsoleFixtures().contacts, 2);
});

