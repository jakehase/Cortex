import { buildChannelPlannerSnapshot, createChannelPlannerReadinessBoard } from '../service-channel-planner.mjs';

export function createChannelPlannerOpsRoutes(basePath = '/ops/channel-planner') {
  const snapshot = buildChannelPlannerSnapshot();
  return [
    { id: 'channel-planner.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createChannelPlannerReadinessBoard(snapshot) },
    { id: 'channel-planner.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'channel-planner.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

