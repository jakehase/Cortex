import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSegmentationQualitySnapshot, createSegmentationQualityDashboardRoutes, createSegmentationQualityApiRoutes, createSegmentationQualityOpsRoutes, createSegmentationQualityPublicRoutes, summarizeSegmentationQualityFixtures } from '../packages/segmentation-quality/index.mjs';

test('segmentation-quality package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildSegmentationQualitySnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createSegmentationQualityDashboardRoutes().length, 3);
  assert.equal(createSegmentationQualityApiRoutes().length, 3);
  assert.equal(createSegmentationQualityOpsRoutes().length, 3);
  assert.equal(createSegmentationQualityPublicRoutes().length, 3);
  assert.equal(summarizeSegmentationQualityFixtures().contacts, 2);
});

