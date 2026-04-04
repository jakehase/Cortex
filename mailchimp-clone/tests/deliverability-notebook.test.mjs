import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliverabilityNotebookSnapshot, createDeliverabilityNotebookDashboardRoutes, createDeliverabilityNotebookApiRoutes, createDeliverabilityNotebookOpsRoutes, createDeliverabilityNotebookPublicRoutes, createDeliverabilityNotebookRegistryRoutes, summarizeDeliverabilityNotebookFixtures } from '../packages/deliverability-notebook/index.mjs';

test('deliverability-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDeliverabilityNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDeliverabilityNotebookDashboardRoutes().length, 3);
  assert.equal(createDeliverabilityNotebookApiRoutes().length, 4);
  assert.equal(createDeliverabilityNotebookOpsRoutes().length, 3);
  assert.equal(createDeliverabilityNotebookPublicRoutes().length, 3);
  assert.equal(createDeliverabilityNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDeliverabilityNotebookFixtures().contacts, 2);
});

