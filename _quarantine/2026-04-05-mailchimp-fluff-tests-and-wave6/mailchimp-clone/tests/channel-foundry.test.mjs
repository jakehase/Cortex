import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelFoundrySnapshot, createChannelFoundryDashboardRoutes, createChannelFoundryApiRoutes, createChannelFoundryOpsRoutes, createChannelFoundryPublicRoutes, createChannelFoundryRegistryRoutes, summarizeChannelFoundryFixtures } from '../packages/channel-foundry/index.mjs';

test('channel-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildChannelFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createChannelFoundryDashboardRoutes().length, 3);
  assert.equal(createChannelFoundryApiRoutes().length, 4);
  assert.equal(createChannelFoundryOpsRoutes().length, 3);
  assert.equal(createChannelFoundryPublicRoutes().length, 3);
  assert.equal(createChannelFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeChannelFoundryFixtures().contacts, 2);
});

