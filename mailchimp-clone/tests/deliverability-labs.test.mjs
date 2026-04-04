import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliverabilityLabsSnapshot, createDeliverabilityLabsDashboardRoutes, createDeliverabilityLabsApiRoutes, createDeliverabilityLabsOpsRoutes, createDeliverabilityLabsPublicRoutes, summarizeDeliverabilityLabsFixtures } from '../packages/deliverability-labs/index.mjs';

test('deliverability-labs package deepens continuation breadth and route catalogs', () => {
  const snapshot = buildDeliverabilityLabsSnapshot('Continuation Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Continuation Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDeliverabilityLabsDashboardRoutes().length, 3);
  assert.equal(createDeliverabilityLabsApiRoutes().length, 3);
  assert.equal(createDeliverabilityLabsOpsRoutes().length, 3);
  assert.equal(createDeliverabilityLabsPublicRoutes().length, 3);
  assert.equal(summarizeDeliverabilityLabsFixtures().contacts, 2);
});
