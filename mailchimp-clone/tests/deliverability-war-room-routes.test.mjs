import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeliverabilityWarRoomDashboardRoutes, createDeliverabilityWarRoomApiRoutes, createDeliverabilityWarRoomOpsRoutes, createDeliverabilityWarRoomPublicRoutes } from '../packages/deliverability-war-room/index.mjs';

test('deliverability-war-room routes honor custom base paths and stable ids', () => {
  const dashboard = createDeliverabilityWarRoomDashboardRoutes('/labs/deliverability-war-room');
  const api = createDeliverabilityWarRoomApiRoutes('/api/labs/deliverability-war-room');
  const ops = createDeliverabilityWarRoomOpsRoutes('/ops/labs/deliverability-war-room');
  const pub = createDeliverabilityWarRoomPublicRoutes('/public/labs/deliverability-war-room');
  assert.equal(dashboard[0].path, '/labs/deliverability-war-room');
  assert.equal(api[0].path, '/api/labs/deliverability-war-room/overview');
  assert.equal(ops[0].path, '/ops/labs/deliverability-war-room/health');
  assert.equal(pub[0].path, '/public/labs/deliverability-war-room');
  assert.match(dashboard[0].id, /deliverability\-war\-room/);
  assert.match(api[2].id, /deliverability\-war\-room/);
});

