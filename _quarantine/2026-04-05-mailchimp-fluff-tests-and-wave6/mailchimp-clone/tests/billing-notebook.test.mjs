import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingNotebookSnapshot, createBillingNotebookDashboardRoutes, createBillingNotebookApiRoutes, createBillingNotebookOpsRoutes, createBillingNotebookPublicRoutes, createBillingNotebookRegistryRoutes, summarizeBillingNotebookFixtures } from '../packages/billing-notebook/index.mjs';

test('billing-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBillingNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBillingNotebookDashboardRoutes().length, 3);
  assert.equal(createBillingNotebookApiRoutes().length, 4);
  assert.equal(createBillingNotebookOpsRoutes().length, 3);
  assert.equal(createBillingNotebookPublicRoutes().length, 3);
  assert.equal(createBillingNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBillingNotebookFixtures().contacts, 2);
});

