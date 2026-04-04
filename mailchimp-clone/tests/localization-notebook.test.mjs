import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalizationNotebookSnapshot, createLocalizationNotebookDashboardRoutes, createLocalizationNotebookApiRoutes, createLocalizationNotebookOpsRoutes, createLocalizationNotebookPublicRoutes, createLocalizationNotebookRegistryRoutes, summarizeLocalizationNotebookFixtures } from '../packages/localization-notebook/index.mjs';

test('localization-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLocalizationNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLocalizationNotebookDashboardRoutes().length, 3);
  assert.equal(createLocalizationNotebookApiRoutes().length, 4);
  assert.equal(createLocalizationNotebookOpsRoutes().length, 3);
  assert.equal(createLocalizationNotebookPublicRoutes().length, 3);
  assert.equal(createLocalizationNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLocalizationNotebookFixtures().contacts, 2);
});

