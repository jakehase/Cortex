import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativeHubSnapshot, createCreativeHubDashboardRoutes, createCreativeHubApiRoutes, createCreativeHubOpsRoutes, createCreativeHubPublicRoutes, createCreativeHubRegistryRoutes, summarizeCreativeHubFixtures } from '../packages/creative-hub/index.mjs';

test('creative-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCreativeHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCreativeHubDashboardRoutes().length, 3);
  assert.equal(createCreativeHubApiRoutes().length, 4);
  assert.equal(createCreativeHubOpsRoutes().length, 3);
  assert.equal(createCreativeHubPublicRoutes().length, 3);
  assert.equal(createCreativeHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCreativeHubFixtures().contacts, 2);
});

