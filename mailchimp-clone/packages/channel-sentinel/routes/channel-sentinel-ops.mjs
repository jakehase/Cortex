import { buildChannelSentinelSnapshot, createChannelSentinelReadinessBoard } from '../service-channel-sentinel.mjs';

export function createChannelSentinelOpsRoutes(basePath = '/ops/channel-sentinel') {
  const snapshot = buildChannelSentinelSnapshot();
  return [
    { id: 'channel-sentinel.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createChannelSentinelReadinessBoard(snapshot) },
    { id: 'channel-sentinel.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'channel-sentinel.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

