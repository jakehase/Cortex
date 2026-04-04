import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceSentinelSnapshot, createAudienceSentinelDashboardRoutes, createAudienceSentinelApiRoutes, createAudienceSentinelOpsRoutes, createAudienceSentinelPublicRoutes, createAudienceSentinelRegistryRoutes, summarizeAudienceSentinelFixtures } from '../packages/audience-sentinel/index.mjs';

test('audience-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAudienceSentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAudienceSentinelDashboardRoutes().length, 3);
  assert.equal(createAudienceSentinelApiRoutes().length, 4);
  assert.equal(createAudienceSentinelOpsRoutes().length, 3);
  assert.equal(createAudienceSentinelPublicRoutes().length, 3);
  assert.equal(createAudienceSentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAudienceSentinelFixtures().contacts, 2);
});

