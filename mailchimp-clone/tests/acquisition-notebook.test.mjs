import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcquisitionNotebookSnapshot, createAcquisitionNotebookDashboardRoutes, createAcquisitionNotebookApiRoutes, createAcquisitionNotebookOpsRoutes, createAcquisitionNotebookPublicRoutes, createAcquisitionNotebookRegistryRoutes, summarizeAcquisitionNotebookFixtures } from '../packages/acquisition-notebook/index.mjs';

test('acquisition-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAcquisitionNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAcquisitionNotebookDashboardRoutes().length, 3);
  assert.equal(createAcquisitionNotebookApiRoutes().length, 4);
  assert.equal(createAcquisitionNotebookOpsRoutes().length, 3);
  assert.equal(createAcquisitionNotebookPublicRoutes().length, 3);
  assert.equal(createAcquisitionNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAcquisitionNotebookFixtures().contacts, 2);
});

