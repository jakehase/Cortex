import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingSentinelSnapshot, createBillingSentinelDashboardRoutes, createBillingSentinelApiRoutes, createBillingSentinelOpsRoutes, createBillingSentinelPublicRoutes, createBillingSentinelRegistryRoutes, summarizeBillingSentinelFixtures } from '../packages/billing-sentinel/index.mjs';

test('billing-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBillingSentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBillingSentinelDashboardRoutes().length, 3);
  assert.equal(createBillingSentinelApiRoutes().length, 4);
  assert.equal(createBillingSentinelOpsRoutes().length, 3);
  assert.equal(createBillingSentinelPublicRoutes().length, 3);
  assert.equal(createBillingSentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBillingSentinelFixtures().contacts, 2);
});

