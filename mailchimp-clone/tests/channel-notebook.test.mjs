import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelNotebookSnapshot, createChannelNotebookDashboardRoutes, createChannelNotebookApiRoutes, createChannelNotebookOpsRoutes, createChannelNotebookPublicRoutes, createChannelNotebookRegistryRoutes, summarizeChannelNotebookFixtures } from '../packages/channel-notebook/index.mjs';

test('channel-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildChannelNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createChannelNotebookDashboardRoutes().length, 3);
  assert.equal(createChannelNotebookApiRoutes().length, 4);
  assert.equal(createChannelNotebookOpsRoutes().length, 3);
  assert.equal(createChannelNotebookPublicRoutes().length, 3);
  assert.equal(createChannelNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeChannelNotebookFixtures().contacts, 2);
});

