import test from 'node:test';
import assert from 'node:assert/strict';
import { createSegmentationQualityDashboardRoutes, createSegmentationQualityApiRoutes, createSegmentationQualityOpsRoutes, createSegmentationQualityPublicRoutes } from '../packages/segmentation-quality/index.mjs';

test('segmentation-quality routes honor custom base paths and stable ids', () => {
  const dashboard = createSegmentationQualityDashboardRoutes('/labs/segmentation-quality');
  const api = createSegmentationQualityApiRoutes('/api/labs/segmentation-quality');
  const ops = createSegmentationQualityOpsRoutes('/ops/labs/segmentation-quality');
  const pub = createSegmentationQualityPublicRoutes('/public/labs/segmentation-quality');
  assert.equal(dashboard[0].path, '/labs/segmentation-quality');
  assert.equal(api[0].path, '/api/labs/segmentation-quality/overview');
  assert.equal(ops[0].path, '/ops/labs/segmentation-quality/health');
  assert.equal(pub[0].path, '/public/labs/segmentation-quality');
  assert.match(dashboard[0].id, /segmentation\-quality/);
  assert.match(api[2].id, /segmentation\-quality/);
});

