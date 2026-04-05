import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataIndexSnapshot, createDataIndexDashboardRoutes, createDataIndexApiRoutes, createDataIndexOpsRoutes, createDataIndexPublicRoutes, createDataIndexRegistryRoutes, summarizeDataIndexFixtures } from '../packages/data-index/index.mjs';

test('data-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDataIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDataIndexDashboardRoutes().length, 3);
  assert.equal(createDataIndexApiRoutes().length, 4);
  assert.equal(createDataIndexOpsRoutes().length, 3);
  assert.equal(createDataIndexPublicRoutes().length, 3);
  assert.equal(createDataIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDataIndexFixtures().contacts, 2);
});

