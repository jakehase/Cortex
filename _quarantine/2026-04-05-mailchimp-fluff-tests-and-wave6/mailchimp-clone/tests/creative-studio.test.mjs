import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativeStudioSnapshot, createCreativeStudioDashboardRoutes, createCreativeStudioApiRoutes, createCreativeStudioOpsRoutes, createCreativeStudioPublicRoutes, createCreativeStudioRegistryRoutes, summarizeCreativeStudioFixtures } from '../packages/creative-studio/index.mjs';

test('creative-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCreativeStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCreativeStudioDashboardRoutes().length, 3);
  assert.equal(createCreativeStudioApiRoutes().length, 4);
  assert.equal(createCreativeStudioOpsRoutes().length, 3);
  assert.equal(createCreativeStudioPublicRoutes().length, 3);
  assert.equal(createCreativeStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCreativeStudioFixtures().contacts, 2);
});

