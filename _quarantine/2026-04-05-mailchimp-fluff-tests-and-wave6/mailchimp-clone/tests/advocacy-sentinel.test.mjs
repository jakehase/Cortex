import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvocacySentinelSnapshot, createAdvocacySentinelDashboardRoutes, createAdvocacySentinelApiRoutes, createAdvocacySentinelOpsRoutes, createAdvocacySentinelPublicRoutes, createAdvocacySentinelRegistryRoutes, summarizeAdvocacySentinelFixtures } from '../packages/advocacy-sentinel/index.mjs';

test('advocacy-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAdvocacySentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAdvocacySentinelDashboardRoutes().length, 3);
  assert.equal(createAdvocacySentinelApiRoutes().length, 4);
  assert.equal(createAdvocacySentinelOpsRoutes().length, 3);
  assert.equal(createAdvocacySentinelPublicRoutes().length, 3);
  assert.equal(createAdvocacySentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAdvocacySentinelFixtures().contacts, 2);
});

