import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentSentinelSnapshot, createContentSentinelDashboardRoutes, createContentSentinelApiRoutes, createContentSentinelOpsRoutes, createContentSentinelPublicRoutes, createContentSentinelRegistryRoutes, summarizeContentSentinelFixtures } from '../packages/content-sentinel/index.mjs';

test('content-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildContentSentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createContentSentinelDashboardRoutes().length, 3);
  assert.equal(createContentSentinelApiRoutes().length, 4);
  assert.equal(createContentSentinelOpsRoutes().length, 3);
  assert.equal(createContentSentinelPublicRoutes().length, 3);
  assert.equal(createContentSentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeContentSentinelFixtures().contacts, 2);
});

