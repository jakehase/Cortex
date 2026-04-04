import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelWorkbenchSnapshot, createChannelWorkbenchDashboardRoutes, createChannelWorkbenchApiRoutes, createChannelWorkbenchOpsRoutes, createChannelWorkbenchPublicRoutes, createChannelWorkbenchRegistryRoutes, summarizeChannelWorkbenchFixtures } from '../packages/channel-workbench/index.mjs';

test('channel-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildChannelWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createChannelWorkbenchDashboardRoutes().length, 3);
  assert.equal(createChannelWorkbenchApiRoutes().length, 4);
  assert.equal(createChannelWorkbenchOpsRoutes().length, 3);
  assert.equal(createChannelWorkbenchPublicRoutes().length, 3);
  assert.equal(createChannelWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeChannelWorkbenchFixtures().contacts, 2);
});

