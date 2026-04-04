import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReleaseTrainSnapshot, createReleaseTrainDashboardRoutes, createReleaseTrainApiRoutes, createReleaseTrainOpsRoutes, createReleaseTrainPublicRoutes, summarizeReleaseTrainFixtures } from '../packages/release-train/index.mjs';

test('release-train package deepens continuation breadth and route catalogs', () => {
  const snapshot = buildReleaseTrainSnapshot('Continuation Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Continuation Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createReleaseTrainDashboardRoutes().length, 3);
  assert.equal(createReleaseTrainApiRoutes().length, 3);
  assert.equal(createReleaseTrainOpsRoutes().length, 3);
  assert.equal(createReleaseTrainPublicRoutes().length, 3);
  assert.equal(summarizeReleaseTrainFixtures().contacts, 2);
});
