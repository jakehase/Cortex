import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoyaltyWorkbenchSnapshot, createLoyaltyWorkbenchDashboardRoutes, createLoyaltyWorkbenchApiRoutes, createLoyaltyWorkbenchOpsRoutes, createLoyaltyWorkbenchPublicRoutes, createLoyaltyWorkbenchRegistryRoutes, summarizeLoyaltyWorkbenchFixtures } from '../packages/loyalty-workbench/index.mjs';

test('loyalty-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLoyaltyWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLoyaltyWorkbenchDashboardRoutes().length, 3);
  assert.equal(createLoyaltyWorkbenchApiRoutes().length, 4);
  assert.equal(createLoyaltyWorkbenchOpsRoutes().length, 3);
  assert.equal(createLoyaltyWorkbenchPublicRoutes().length, 3);
  assert.equal(createLoyaltyWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLoyaltyWorkbenchFixtures().contacts, 2);
});

