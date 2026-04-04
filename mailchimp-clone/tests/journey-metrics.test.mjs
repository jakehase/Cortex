import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJourneyMetricsSnapshot, createJourneyMetricsDashboardRoutes, createJourneyMetricsApiRoutes, createJourneyMetricsOpsRoutes, createJourneyMetricsPublicRoutes, summarizeJourneyMetricsFixtures } from '../packages/journey-metrics/index.mjs';

test('journey-metrics package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildJourneyMetricsSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createJourneyMetricsDashboardRoutes().length, 3);
  assert.equal(createJourneyMetricsApiRoutes().length, 3);
  assert.equal(createJourneyMetricsOpsRoutes().length, 3);
  assert.equal(createJourneyMetricsPublicRoutes().length, 3);
  assert.equal(summarizeJourneyMetricsFixtures().contacts, 2);
});
