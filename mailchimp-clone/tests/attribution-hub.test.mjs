import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributionHubSnapshot, createAttributionHubDashboardRoutes, createAttributionHubApiRoutes, createAttributionHubOpsRoutes, createAttributionHubPublicRoutes, createAttributionHubRegistryRoutes, summarizeAttributionHubFixtures } from '../packages/attribution-hub/index.mjs';

test('attribution-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAttributionHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAttributionHubDashboardRoutes().length, 3);
  assert.equal(createAttributionHubApiRoutes().length, 4);
  assert.equal(createAttributionHubOpsRoutes().length, 3);
  assert.equal(createAttributionHubPublicRoutes().length, 3);
  assert.equal(createAttributionHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAttributionHubFixtures().contacts, 2);
});

