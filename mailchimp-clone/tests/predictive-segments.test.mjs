import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPredictiveSegmentsSnapshot, createPredictiveSegmentsDashboardRoutes, createPredictiveSegmentsApiRoutes, createPredictiveSegmentsOpsRoutes, createPredictiveSegmentsPublicRoutes, summarizePredictiveSegmentsFixtures } from '../packages/predictive-segments/index.mjs';

test('predictive-segments package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildPredictiveSegmentsSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createPredictiveSegmentsDashboardRoutes().length, 3);
  assert.equal(createPredictiveSegmentsApiRoutes().length, 3);
  assert.equal(createPredictiveSegmentsOpsRoutes().length, 3);
  assert.equal(createPredictiveSegmentsPublicRoutes().length, 3);
  assert.equal(summarizePredictiveSegmentsFixtures().contacts, 2);
});

