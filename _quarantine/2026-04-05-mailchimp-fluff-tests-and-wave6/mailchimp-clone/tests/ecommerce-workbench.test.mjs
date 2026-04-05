import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEcommerceWorkbenchSnapshot, createEcommerceWorkbenchDashboardRoutes, createEcommerceWorkbenchApiRoutes, createEcommerceWorkbenchOpsRoutes, createEcommerceWorkbenchPublicRoutes, createEcommerceWorkbenchRegistryRoutes, summarizeEcommerceWorkbenchFixtures } from '../packages/ecommerce-workbench/index.mjs';

test('ecommerce-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildEcommerceWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createEcommerceWorkbenchDashboardRoutes().length, 3);
  assert.equal(createEcommerceWorkbenchApiRoutes().length, 4);
  assert.equal(createEcommerceWorkbenchOpsRoutes().length, 3);
  assert.equal(createEcommerceWorkbenchPublicRoutes().length, 3);
  assert.equal(createEcommerceWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeEcommerceWorkbenchFixtures().contacts, 2);
});

