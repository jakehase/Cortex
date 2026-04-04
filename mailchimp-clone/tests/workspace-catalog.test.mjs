import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspaceCatalogSnapshot, createWorkspaceCatalogDashboardRoutes, createWorkspaceCatalogApiRoutes, createWorkspaceCatalogOpsRoutes, createWorkspaceCatalogPublicRoutes, summarizeWorkspaceCatalogFixtures } from '../packages/workspace-catalog/index.mjs';

test('workspace-catalog package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildWorkspaceCatalogSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createWorkspaceCatalogDashboardRoutes().length, 3);
  assert.equal(createWorkspaceCatalogApiRoutes().length, 3);
  assert.equal(createWorkspaceCatalogOpsRoutes().length, 3);
  assert.equal(createWorkspaceCatalogPublicRoutes().length, 3);
  assert.equal(summarizeWorkspaceCatalogFixtures().contacts, 2);
});
