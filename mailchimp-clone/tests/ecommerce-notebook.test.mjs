import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEcommerceNotebookSnapshot, createEcommerceNotebookDashboardRoutes, createEcommerceNotebookApiRoutes, createEcommerceNotebookOpsRoutes, createEcommerceNotebookPublicRoutes, createEcommerceNotebookRegistryRoutes, summarizeEcommerceNotebookFixtures } from '../packages/ecommerce-notebook/index.mjs';

test('ecommerce-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildEcommerceNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createEcommerceNotebookDashboardRoutes().length, 3);
  assert.equal(createEcommerceNotebookApiRoutes().length, 4);
  assert.equal(createEcommerceNotebookOpsRoutes().length, 3);
  assert.equal(createEcommerceNotebookPublicRoutes().length, 3);
  assert.equal(createEcommerceNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeEcommerceNotebookFixtures().contacts, 2);
});

