import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivationSentinelSnapshot, createActivationSentinelDashboardRoutes, createActivationSentinelApiRoutes, createActivationSentinelOpsRoutes, createActivationSentinelPublicRoutes, createActivationSentinelRegistryRoutes, summarizeActivationSentinelFixtures } from '../packages/activation-sentinel/index.mjs';

test('activation-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildActivationSentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createActivationSentinelDashboardRoutes().length, 3);
  assert.equal(createActivationSentinelApiRoutes().length, 4);
  assert.equal(createActivationSentinelOpsRoutes().length, 3);
  assert.equal(createActivationSentinelPublicRoutes().length, 3);
  assert.equal(createActivationSentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeActivationSentinelFixtures().contacts, 2);
});

