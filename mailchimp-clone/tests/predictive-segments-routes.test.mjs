import test from 'node:test';
import assert from 'node:assert/strict';
import { createPredictiveSegmentsDashboardRoutes, createPredictiveSegmentsApiRoutes, createPredictiveSegmentsOpsRoutes, createPredictiveSegmentsPublicRoutes } from '../packages/predictive-segments/index.mjs';

test('predictive-segments routes honor custom base paths and stable ids', () => {
  const dashboard = createPredictiveSegmentsDashboardRoutes('/labs/predictive-segments');
  const api = createPredictiveSegmentsApiRoutes('/api/labs/predictive-segments');
  const ops = createPredictiveSegmentsOpsRoutes('/ops/labs/predictive-segments');
  const pub = createPredictiveSegmentsPublicRoutes('/public/labs/predictive-segments');
  assert.equal(dashboard[0].path, '/labs/predictive-segments');
  assert.equal(api[0].path, '/api/labs/predictive-segments/overview');
  assert.equal(ops[0].path, '/ops/labs/predictive-segments/health');
  assert.equal(pub[0].path, '/public/labs/predictive-segments');
  assert.match(dashboard[0].id, /predictive\-segments/);
  assert.match(api[2].id, /predictive\-segments/);
});

