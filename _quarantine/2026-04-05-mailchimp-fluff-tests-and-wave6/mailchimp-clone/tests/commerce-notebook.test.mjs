import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommerceNotebookSnapshot, createCommerceNotebookDashboardRoutes, createCommerceNotebookApiRoutes, createCommerceNotebookOpsRoutes, createCommerceNotebookPublicRoutes, createCommerceNotebookRegistryRoutes, summarizeCommerceNotebookFixtures } from '../packages/commerce-notebook/index.mjs';

test('commerce-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCommerceNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCommerceNotebookDashboardRoutes().length, 3);
  assert.equal(createCommerceNotebookApiRoutes().length, 4);
  assert.equal(createCommerceNotebookOpsRoutes().length, 3);
  assert.equal(createCommerceNotebookPublicRoutes().length, 3);
  assert.equal(createCommerceNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCommerceNotebookFixtures().contacts, 2);
});

