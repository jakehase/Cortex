import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributionFoundrySnapshot, createAttributionFoundryDashboardRoutes, createAttributionFoundryApiRoutes, createAttributionFoundryOpsRoutes, createAttributionFoundryPublicRoutes, createAttributionFoundryRegistryRoutes, summarizeAttributionFoundryFixtures } from '../packages/attribution-foundry/index.mjs';

test('attribution-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAttributionFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAttributionFoundryDashboardRoutes().length, 3);
  assert.equal(createAttributionFoundryApiRoutes().length, 4);
  assert.equal(createAttributionFoundryOpsRoutes().length, 3);
  assert.equal(createAttributionFoundryPublicRoutes().length, 3);
  assert.equal(createAttributionFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAttributionFoundryFixtures().contacts, 2);
});

