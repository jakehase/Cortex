import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentHubSnapshot, createContentHubDashboardRoutes, createContentHubApiRoutes, createContentHubOpsRoutes, createContentHubPublicRoutes, createContentHubRegistryRoutes, summarizeContentHubFixtures } from '../packages/content-hub/index.mjs';

test('content-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildContentHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createContentHubDashboardRoutes().length, 3);
  assert.equal(createContentHubApiRoutes().length, 4);
  assert.equal(createContentHubOpsRoutes().length, 3);
  assert.equal(createContentHubPublicRoutes().length, 3);
  assert.equal(createContentHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeContentHubFixtures().contacts, 2);
});

