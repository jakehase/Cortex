import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelGridSnapshot, createChannelGridDashboardRoutes, createChannelGridApiRoutes, createChannelGridOpsRoutes, createChannelGridPublicRoutes, createChannelGridRegistryRoutes, summarizeChannelGridFixtures } from '../packages/channel-grid/index.mjs';

test('channel-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildChannelGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createChannelGridDashboardRoutes().length, 3);
  assert.equal(createChannelGridApiRoutes().length, 4);
  assert.equal(createChannelGridOpsRoutes().length, 3);
  assert.equal(createChannelGridPublicRoutes().length, 3);
  assert.equal(createChannelGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeChannelGridFixtures().contacts, 2);
});

