import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommerceWorkbenchSnapshot, createCommerceWorkbenchDashboardRoutes, createCommerceWorkbenchApiRoutes, createCommerceWorkbenchOpsRoutes, createCommerceWorkbenchPublicRoutes, createCommerceWorkbenchRegistryRoutes, summarizeCommerceWorkbenchFixtures } from '../packages/commerce-workbench/index.mjs';

test('commerce-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCommerceWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCommerceWorkbenchDashboardRoutes().length, 3);
  assert.equal(createCommerceWorkbenchApiRoutes().length, 4);
  assert.equal(createCommerceWorkbenchOpsRoutes().length, 3);
  assert.equal(createCommerceWorkbenchPublicRoutes().length, 3);
  assert.equal(createCommerceWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCommerceWorkbenchFixtures().contacts, 2);
});

