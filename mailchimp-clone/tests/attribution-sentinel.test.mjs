import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributionSentinelSnapshot, createAttributionSentinelDashboardRoutes, createAttributionSentinelApiRoutes, createAttributionSentinelOpsRoutes, createAttributionSentinelPublicRoutes, createAttributionSentinelRegistryRoutes, summarizeAttributionSentinelFixtures } from '../packages/attribution-sentinel/index.mjs';

test('attribution-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAttributionSentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAttributionSentinelDashboardRoutes().length, 3);
  assert.equal(createAttributionSentinelApiRoutes().length, 4);
  assert.equal(createAttributionSentinelOpsRoutes().length, 3);
  assert.equal(createAttributionSentinelPublicRoutes().length, 3);
  assert.equal(createAttributionSentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAttributionSentinelFixtures().contacts, 2);
});

