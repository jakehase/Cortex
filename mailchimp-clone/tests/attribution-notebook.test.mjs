import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributionNotebookSnapshot, createAttributionNotebookDashboardRoutes, createAttributionNotebookApiRoutes, createAttributionNotebookOpsRoutes, createAttributionNotebookPublicRoutes, createAttributionNotebookRegistryRoutes, summarizeAttributionNotebookFixtures } from '../packages/attribution-notebook/index.mjs';

test('attribution-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAttributionNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAttributionNotebookDashboardRoutes().length, 3);
  assert.equal(createAttributionNotebookApiRoutes().length, 4);
  assert.equal(createAttributionNotebookOpsRoutes().length, 3);
  assert.equal(createAttributionNotebookPublicRoutes().length, 3);
  assert.equal(createAttributionNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAttributionNotebookFixtures().contacts, 2);
});

