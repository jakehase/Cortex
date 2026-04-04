import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataStudioSnapshot, createDataStudioDashboardRoutes, createDataStudioApiRoutes, createDataStudioOpsRoutes, createDataStudioPublicRoutes, createDataStudioRegistryRoutes, summarizeDataStudioFixtures } from '../packages/data-studio/index.mjs';

test('data-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDataStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDataStudioDashboardRoutes().length, 3);
  assert.equal(createDataStudioApiRoutes().length, 4);
  assert.equal(createDataStudioOpsRoutes().length, 3);
  assert.equal(createDataStudioPublicRoutes().length, 3);
  assert.equal(createDataStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDataStudioFixtures().contacts, 2);
});

