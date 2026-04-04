import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSegmentationLabSnapshot, createSegmentationLabDashboardRoutes, createSegmentationLabApiRoutes, createSegmentationLabOpsRoutes, createSegmentationLabPublicRoutes, summarizeSegmentationLabFixtures } from '../packages/segmentation-lab/index.mjs';

test('segmentation-lab package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildSegmentationLabSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createSegmentationLabDashboardRoutes().length, 3);
  assert.equal(createSegmentationLabApiRoutes().length, 3);
  assert.equal(createSegmentationLabOpsRoutes().length, 3);
  assert.equal(createSegmentationLabPublicRoutes().length, 3);
  assert.equal(summarizeSegmentationLabFixtures().contacts, 2);
});
