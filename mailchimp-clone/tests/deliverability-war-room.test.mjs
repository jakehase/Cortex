import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliverabilityWarRoomSnapshot, createDeliverabilityWarRoomDashboardRoutes, createDeliverabilityWarRoomApiRoutes, createDeliverabilityWarRoomOpsRoutes, createDeliverabilityWarRoomPublicRoutes, summarizeDeliverabilityWarRoomFixtures } from '../packages/deliverability-war-room/index.mjs';

test('deliverability-war-room package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildDeliverabilityWarRoomSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDeliverabilityWarRoomDashboardRoutes().length, 3);
  assert.equal(createDeliverabilityWarRoomApiRoutes().length, 3);
  assert.equal(createDeliverabilityWarRoomOpsRoutes().length, 3);
  assert.equal(createDeliverabilityWarRoomPublicRoutes().length, 3);
  assert.equal(summarizeDeliverabilityWarRoomFixtures().contacts, 2);
});

