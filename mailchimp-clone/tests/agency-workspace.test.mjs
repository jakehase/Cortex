import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgencyWorkspaceSnapshot, createAgencyWorkspaceDashboardRoutes, createAgencyWorkspaceApiRoutes, createAgencyWorkspaceOpsRoutes, createAgencyWorkspacePublicRoutes, summarizeAgencyWorkspaceFixtures } from '../packages/agency-workspace/index.mjs';

test('agency-workspace package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildAgencyWorkspaceSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAgencyWorkspaceDashboardRoutes().length, 3);
  assert.equal(createAgencyWorkspaceApiRoutes().length, 3);
  assert.equal(createAgencyWorkspaceOpsRoutes().length, 3);
  assert.equal(createAgencyWorkspacePublicRoutes().length, 3);
  assert.equal(summarizeAgencyWorkspaceFixtures().contacts, 2);
});
