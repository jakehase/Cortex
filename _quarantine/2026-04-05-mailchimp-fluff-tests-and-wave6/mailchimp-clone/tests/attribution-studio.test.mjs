import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributionStudioSnapshot, createAttributionStudioDashboardRoutes, createAttributionStudioApiRoutes, createAttributionStudioOpsRoutes, createAttributionStudioPublicRoutes, createAttributionStudioRegistryRoutes, summarizeAttributionStudioFixtures } from '../packages/attribution-studio/index.mjs';

test('attribution-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAttributionStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAttributionStudioDashboardRoutes().length, 3);
  assert.equal(createAttributionStudioApiRoutes().length, 4);
  assert.equal(createAttributionStudioOpsRoutes().length, 3);
  assert.equal(createAttributionStudioPublicRoutes().length, 3);
  assert.equal(createAttributionStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAttributionStudioFixtures().contacts, 2);
});

