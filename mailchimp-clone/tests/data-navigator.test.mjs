import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataNavigatorSnapshot, createDataNavigatorDashboardRoutes, createDataNavigatorApiRoutes, createDataNavigatorOpsRoutes, createDataNavigatorPublicRoutes, createDataNavigatorRegistryRoutes, summarizeDataNavigatorFixtures } from '../packages/data-navigator/index.mjs';

test('data-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDataNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDataNavigatorDashboardRoutes().length, 3);
  assert.equal(createDataNavigatorApiRoutes().length, 4);
  assert.equal(createDataNavigatorOpsRoutes().length, 3);
  assert.equal(createDataNavigatorPublicRoutes().length, 3);
  assert.equal(createDataNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDataNavigatorFixtures().contacts, 2);
});

