import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelVaultSnapshot, createChannelVaultDashboardRoutes, createChannelVaultApiRoutes, createChannelVaultOpsRoutes, createChannelVaultPublicRoutes, createChannelVaultRegistryRoutes, summarizeChannelVaultFixtures } from '../packages/channel-vault/index.mjs';

test('channel-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildChannelVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createChannelVaultDashboardRoutes().length, 3);
  assert.equal(createChannelVaultApiRoutes().length, 4);
  assert.equal(createChannelVaultOpsRoutes().length, 3);
  assert.equal(createChannelVaultPublicRoutes().length, 3);
  assert.equal(createChannelVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeChannelVaultFixtures().contacts, 2);
});

