import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelPlannerSnapshot, createChannelPlannerDashboardRoutes, createChannelPlannerApiRoutes, createChannelPlannerOpsRoutes, createChannelPlannerPublicRoutes, createChannelPlannerRegistryRoutes, summarizeChannelPlannerFixtures } from '../packages/channel-planner/index.mjs';

test('channel-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildChannelPlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createChannelPlannerDashboardRoutes().length, 3);
  assert.equal(createChannelPlannerApiRoutes().length, 4);
  assert.equal(createChannelPlannerOpsRoutes().length, 3);
  assert.equal(createChannelPlannerPublicRoutes().length, 3);
  assert.equal(createChannelPlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeChannelPlannerFixtures().contacts, 2);
});

