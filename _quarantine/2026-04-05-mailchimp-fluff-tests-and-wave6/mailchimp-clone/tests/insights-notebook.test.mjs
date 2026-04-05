import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsightsNotebookSnapshot, createInsightsNotebookDashboardRoutes, createInsightsNotebookApiRoutes, createInsightsNotebookOpsRoutes, createInsightsNotebookPublicRoutes, createInsightsNotebookRegistryRoutes, summarizeInsightsNotebookFixtures } from '../packages/insights-notebook/index.mjs';

test('insights-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildInsightsNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createInsightsNotebookDashboardRoutes().length, 3);
  assert.equal(createInsightsNotebookApiRoutes().length, 4);
  assert.equal(createInsightsNotebookOpsRoutes().length, 3);
  assert.equal(createInsightsNotebookPublicRoutes().length, 3);
  assert.equal(createInsightsNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeInsightsNotebookFixtures().contacts, 2);
});

