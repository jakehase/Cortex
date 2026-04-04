import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelAdvisorSnapshot, createChannelAdvisorDashboardRoutes, createChannelAdvisorApiRoutes, createChannelAdvisorOpsRoutes, createChannelAdvisorPublicRoutes, createChannelAdvisorRegistryRoutes, summarizeChannelAdvisorFixtures } from '../packages/channel-advisor/index.mjs';

test('channel-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildChannelAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createChannelAdvisorDashboardRoutes().length, 3);
  assert.equal(createChannelAdvisorApiRoutes().length, 4);
  assert.equal(createChannelAdvisorOpsRoutes().length, 3);
  assert.equal(createChannelAdvisorPublicRoutes().length, 3);
  assert.equal(createChannelAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeChannelAdvisorFixtures().contacts, 2);
});

