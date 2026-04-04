import { buildChannelStudioSnapshot, createChannelStudioReadinessBoard } from '../service-channel-studio.mjs';

export function createChannelStudioOpsRoutes(basePath = '/ops/channel-studio') {
  const snapshot = buildChannelStudioSnapshot();
  return [
    { id: 'channel-studio.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createChannelStudioReadinessBoard(snapshot) },
    { id: 'channel-studio.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'channel-studio.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

