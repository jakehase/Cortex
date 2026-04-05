import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataCockpitSnapshot, createDataCockpitDashboardRoutes, createDataCockpitApiRoutes, createDataCockpitOpsRoutes, createDataCockpitPublicRoutes, createDataCockpitRegistryRoutes, summarizeDataCockpitFixtures } from '../packages/data-cockpit/index.mjs';

test('data-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDataCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDataCockpitDashboardRoutes().length, 3);
  assert.equal(createDataCockpitApiRoutes().length, 4);
  assert.equal(createDataCockpitOpsRoutes().length, 3);
  assert.equal(createDataCockpitPublicRoutes().length, 3);
  assert.equal(createDataCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDataCockpitFixtures().contacts, 2);
});

