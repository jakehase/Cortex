import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelAtlasSnapshot, createChannelAtlasDashboardRoutes, createChannelAtlasApiRoutes, createChannelAtlasOpsRoutes, createChannelAtlasPublicRoutes, createChannelAtlasRegistryRoutes, summarizeChannelAtlasFixtures } from '../packages/channel-atlas/index.mjs';

test('channel-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildChannelAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createChannelAtlasDashboardRoutes().length, 3);
  assert.equal(createChannelAtlasApiRoutes().length, 4);
  assert.equal(createChannelAtlasOpsRoutes().length, 3);
  assert.equal(createChannelAtlasPublicRoutes().length, 3);
  assert.equal(createChannelAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeChannelAtlasFixtures().contacts, 2);
});

