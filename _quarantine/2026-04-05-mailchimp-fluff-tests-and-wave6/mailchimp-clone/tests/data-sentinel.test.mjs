import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataSentinelSnapshot, createDataSentinelDashboardRoutes, createDataSentinelApiRoutes, createDataSentinelOpsRoutes, createDataSentinelPublicRoutes, createDataSentinelRegistryRoutes, summarizeDataSentinelFixtures } from '../packages/data-sentinel/index.mjs';

test('data-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDataSentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDataSentinelDashboardRoutes().length, 3);
  assert.equal(createDataSentinelApiRoutes().length, 4);
  assert.equal(createDataSentinelOpsRoutes().length, 3);
  assert.equal(createDataSentinelPublicRoutes().length, 3);
  assert.equal(createDataSentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDataSentinelFixtures().contacts, 2);
});

