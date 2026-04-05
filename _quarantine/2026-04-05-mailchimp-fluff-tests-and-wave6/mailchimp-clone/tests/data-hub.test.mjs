import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataHubSnapshot, createDataHubDashboardRoutes, createDataHubApiRoutes, createDataHubOpsRoutes, createDataHubPublicRoutes, createDataHubRegistryRoutes, summarizeDataHubFixtures } from '../packages/data-hub/index.mjs';

test('data-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDataHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDataHubDashboardRoutes().length, 3);
  assert.equal(createDataHubApiRoutes().length, 4);
  assert.equal(createDataHubOpsRoutes().length, 3);
  assert.equal(createDataHubPublicRoutes().length, 3);
  assert.equal(createDataHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDataHubFixtures().contacts, 2);
});

