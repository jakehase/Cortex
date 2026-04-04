import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelCockpitSnapshot, createChannelCockpitDashboardRoutes, createChannelCockpitApiRoutes, createChannelCockpitOpsRoutes, createChannelCockpitPublicRoutes, createChannelCockpitRegistryRoutes, summarizeChannelCockpitFixtures } from '../packages/channel-cockpit/index.mjs';

test('channel-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildChannelCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createChannelCockpitDashboardRoutes().length, 3);
  assert.equal(createChannelCockpitApiRoutes().length, 4);
  assert.equal(createChannelCockpitOpsRoutes().length, 3);
  assert.equal(createChannelCockpitPublicRoutes().length, 3);
  assert.equal(createChannelCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeChannelCockpitFixtures().contacts, 2);
});

