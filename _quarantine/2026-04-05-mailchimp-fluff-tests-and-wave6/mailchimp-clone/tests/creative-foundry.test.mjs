import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativeFoundrySnapshot, createCreativeFoundryDashboardRoutes, createCreativeFoundryApiRoutes, createCreativeFoundryOpsRoutes, createCreativeFoundryPublicRoutes, createCreativeFoundryRegistryRoutes, summarizeCreativeFoundryFixtures } from '../packages/creative-foundry/index.mjs';

test('creative-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCreativeFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCreativeFoundryDashboardRoutes().length, 3);
  assert.equal(createCreativeFoundryApiRoutes().length, 4);
  assert.equal(createCreativeFoundryOpsRoutes().length, 3);
  assert.equal(createCreativeFoundryPublicRoutes().length, 3);
  assert.equal(createCreativeFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCreativeFoundryFixtures().contacts, 2);
});

