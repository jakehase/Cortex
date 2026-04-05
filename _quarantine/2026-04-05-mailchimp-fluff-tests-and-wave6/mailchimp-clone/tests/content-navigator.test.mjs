import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentNavigatorSnapshot, createContentNavigatorDashboardRoutes, createContentNavigatorApiRoutes, createContentNavigatorOpsRoutes, createContentNavigatorPublicRoutes, createContentNavigatorRegistryRoutes, summarizeContentNavigatorFixtures } from '../packages/content-navigator/index.mjs';

test('content-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildContentNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createContentNavigatorDashboardRoutes().length, 3);
  assert.equal(createContentNavigatorApiRoutes().length, 4);
  assert.equal(createContentNavigatorOpsRoutes().length, 3);
  assert.equal(createContentNavigatorPublicRoutes().length, 3);
  assert.equal(createContentNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeContentNavigatorFixtures().contacts, 2);
});

