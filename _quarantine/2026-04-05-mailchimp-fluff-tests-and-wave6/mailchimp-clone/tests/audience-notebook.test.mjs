import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceNotebookSnapshot, createAudienceNotebookDashboardRoutes, createAudienceNotebookApiRoutes, createAudienceNotebookOpsRoutes, createAudienceNotebookPublicRoutes, createAudienceNotebookRegistryRoutes, summarizeAudienceNotebookFixtures } from '../packages/audience-notebook/index.mjs';

test('audience-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAudienceNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAudienceNotebookDashboardRoutes().length, 3);
  assert.equal(createAudienceNotebookApiRoutes().length, 4);
  assert.equal(createAudienceNotebookOpsRoutes().length, 3);
  assert.equal(createAudienceNotebookPublicRoutes().length, 3);
  assert.equal(createAudienceNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAudienceNotebookFixtures().contacts, 2);
});

