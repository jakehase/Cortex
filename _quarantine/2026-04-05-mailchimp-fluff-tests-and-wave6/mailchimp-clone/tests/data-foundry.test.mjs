import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataFoundrySnapshot, createDataFoundryDashboardRoutes, createDataFoundryApiRoutes, createDataFoundryOpsRoutes, createDataFoundryPublicRoutes, createDataFoundryRegistryRoutes, summarizeDataFoundryFixtures } from '../packages/data-foundry/index.mjs';

test('data-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDataFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDataFoundryDashboardRoutes().length, 3);
  assert.equal(createDataFoundryApiRoutes().length, 4);
  assert.equal(createDataFoundryOpsRoutes().length, 3);
  assert.equal(createDataFoundryPublicRoutes().length, 3);
  assert.equal(createDataFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDataFoundryFixtures().contacts, 2);
});

