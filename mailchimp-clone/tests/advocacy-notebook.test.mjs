import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvocacyNotebookSnapshot, createAdvocacyNotebookDashboardRoutes, createAdvocacyNotebookApiRoutes, createAdvocacyNotebookOpsRoutes, createAdvocacyNotebookPublicRoutes, createAdvocacyNotebookRegistryRoutes, summarizeAdvocacyNotebookFixtures } from '../packages/advocacy-notebook/index.mjs';

test('advocacy-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAdvocacyNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAdvocacyNotebookDashboardRoutes().length, 3);
  assert.equal(createAdvocacyNotebookApiRoutes().length, 4);
  assert.equal(createAdvocacyNotebookOpsRoutes().length, 3);
  assert.equal(createAdvocacyNotebookPublicRoutes().length, 3);
  assert.equal(createAdvocacyNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAdvocacyNotebookFixtures().contacts, 2);
});

