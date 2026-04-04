import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMultiBrandHqSnapshot, createMultiBrandHqDashboardRoutes, createMultiBrandHqApiRoutes, createMultiBrandHqOpsRoutes, createMultiBrandHqPublicRoutes, summarizeMultiBrandHqFixtures } from '../packages/multi-brand-hq/index.mjs';

test('multi-brand-hq package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildMultiBrandHqSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createMultiBrandHqDashboardRoutes().length, 3);
  assert.equal(createMultiBrandHqApiRoutes().length, 3);
  assert.equal(createMultiBrandHqOpsRoutes().length, 3);
  assert.equal(createMultiBrandHqPublicRoutes().length, 3);
  assert.equal(summarizeMultiBrandHqFixtures().contacts, 2);
});
