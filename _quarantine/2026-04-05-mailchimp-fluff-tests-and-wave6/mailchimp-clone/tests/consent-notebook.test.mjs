import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConsentNotebookSnapshot, createConsentNotebookDashboardRoutes, createConsentNotebookApiRoutes, createConsentNotebookOpsRoutes, createConsentNotebookPublicRoutes, createConsentNotebookRegistryRoutes, summarizeConsentNotebookFixtures } from '../packages/consent-notebook/index.mjs';

test('consent-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildConsentNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createConsentNotebookDashboardRoutes().length, 3);
  assert.equal(createConsentNotebookApiRoutes().length, 4);
  assert.equal(createConsentNotebookOpsRoutes().length, 3);
  assert.equal(createConsentNotebookPublicRoutes().length, 3);
  assert.equal(createConsentNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeConsentNotebookFixtures().contacts, 2);
});

