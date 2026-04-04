import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpsObservabilitySnapshot, createOpsObservabilityDashboardRoutes, createOpsObservabilityApiRoutes, createOpsObservabilityOpsRoutes, createOpsObservabilityPublicRoutes, summarizeOpsObservabilityFixtures } from '../packages/ops-observability/index.mjs';

test('ops-observability package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildOpsObservabilitySnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createOpsObservabilityDashboardRoutes().length, 3);
  assert.equal(createOpsObservabilityApiRoutes().length, 3);
  assert.equal(createOpsObservabilityOpsRoutes().length, 3);
  assert.equal(createOpsObservabilityPublicRoutes().length, 3);
  assert.equal(summarizeOpsObservabilityFixtures().contacts, 2);
});
