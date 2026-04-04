import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelExchangeSnapshot, createChannelExchangeDashboardRoutes, createChannelExchangeApiRoutes, createChannelExchangeOpsRoutes, createChannelExchangePublicRoutes, createChannelExchangeRegistryRoutes, summarizeChannelExchangeFixtures } from '../packages/channel-exchange/index.mjs';

test('channel-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildChannelExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createChannelExchangeDashboardRoutes().length, 3);
  assert.equal(createChannelExchangeApiRoutes().length, 4);
  assert.equal(createChannelExchangeOpsRoutes().length, 3);
  assert.equal(createChannelExchangePublicRoutes().length, 3);
  assert.equal(createChannelExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeChannelExchangeFixtures().contacts, 2);
});

