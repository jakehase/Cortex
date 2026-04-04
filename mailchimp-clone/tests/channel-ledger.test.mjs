import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelLedgerSnapshot, createChannelLedgerDashboardRoutes, createChannelLedgerApiRoutes, createChannelLedgerOpsRoutes, createChannelLedgerPublicRoutes, createChannelLedgerRegistryRoutes, summarizeChannelLedgerFixtures } from '../packages/channel-ledger/index.mjs';

test('channel-ledger generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildChannelLedgerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createChannelLedgerDashboardRoutes().length, 3);
  assert.equal(createChannelLedgerApiRoutes().length, 4);
  assert.equal(createChannelLedgerOpsRoutes().length, 3);
  assert.equal(createChannelLedgerPublicRoutes().length, 3);
  assert.equal(createChannelLedgerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeChannelLedgerFixtures().contacts, 2);
});

