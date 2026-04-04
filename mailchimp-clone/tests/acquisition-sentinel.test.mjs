import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcquisitionSentinelSnapshot, createAcquisitionSentinelDashboardRoutes, createAcquisitionSentinelApiRoutes, createAcquisitionSentinelOpsRoutes, createAcquisitionSentinelPublicRoutes, createAcquisitionSentinelRegistryRoutes, summarizeAcquisitionSentinelFixtures } from '../packages/acquisition-sentinel/index.mjs';

test('acquisition-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAcquisitionSentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAcquisitionSentinelDashboardRoutes().length, 3);
  assert.equal(createAcquisitionSentinelApiRoutes().length, 4);
  assert.equal(createAcquisitionSentinelOpsRoutes().length, 3);
  assert.equal(createAcquisitionSentinelPublicRoutes().length, 3);
  assert.equal(createAcquisitionSentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAcquisitionSentinelFixtures().contacts, 2);
});

