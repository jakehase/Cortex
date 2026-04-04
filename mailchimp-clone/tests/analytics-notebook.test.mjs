import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsNotebookSnapshot, createAnalyticsNotebookDashboardRoutes, createAnalyticsNotebookApiRoutes, createAnalyticsNotebookOpsRoutes, createAnalyticsNotebookPublicRoutes, createAnalyticsNotebookRegistryRoutes, summarizeAnalyticsNotebookFixtures } from '../packages/analytics-notebook/index.mjs';

test('analytics-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAnalyticsNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAnalyticsNotebookDashboardRoutes().length, 3);
  assert.equal(createAnalyticsNotebookApiRoutes().length, 4);
  assert.equal(createAnalyticsNotebookOpsRoutes().length, 3);
  assert.equal(createAnalyticsNotebookPublicRoutes().length, 3);
  assert.equal(createAnalyticsNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAnalyticsNotebookFixtures().contacts, 2);
});

