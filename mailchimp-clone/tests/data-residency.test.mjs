import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataResidencySnapshot, createDataResidencyDashboardRoutes, createDataResidencyApiRoutes, createDataResidencyOpsRoutes, createDataResidencyPublicRoutes, summarizeDataResidencyFixtures } from '../packages/data-residency/index.mjs';

test('data-residency package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildDataResidencySnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDataResidencyDashboardRoutes().length, 3);
  assert.equal(createDataResidencyApiRoutes().length, 3);
  assert.equal(createDataResidencyOpsRoutes().length, 3);
  assert.equal(createDataResidencyPublicRoutes().length, 3);
  assert.equal(summarizeDataResidencyFixtures().contacts, 2);
});
