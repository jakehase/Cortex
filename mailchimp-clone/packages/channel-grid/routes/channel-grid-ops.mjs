import { buildChannelGridSnapshot, createChannelGridReadinessBoard } from '../service-channel-grid.mjs';

export function createChannelGridOpsRoutes(basePath = '/ops/channel-grid') {
  const snapshot = buildChannelGridSnapshot();
  return [
    { id: 'channel-grid.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createChannelGridReadinessBoard(snapshot) },
    { id: 'channel-grid.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'channel-grid.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

