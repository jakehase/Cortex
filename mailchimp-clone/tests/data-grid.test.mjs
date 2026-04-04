import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataGridSnapshot, createDataGridDashboardRoutes, createDataGridApiRoutes, createDataGridOpsRoutes, createDataGridPublicRoutes, createDataGridRegistryRoutes, summarizeDataGridFixtures } from '../packages/data-grid/index.mjs';

test('data-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDataGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDataGridDashboardRoutes().length, 3);
  assert.equal(createDataGridApiRoutes().length, 4);
  assert.equal(createDataGridOpsRoutes().length, 3);
  assert.equal(createDataGridPublicRoutes().length, 3);
  assert.equal(createDataGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDataGridFixtures().contacts, 2);
});

