import { buildChannelIndexSnapshot, createChannelIndexReadinessBoard } from '../service-channel-index.mjs';

export function createChannelIndexOpsRoutes(basePath = '/ops/channel-index') {
  const snapshot = buildChannelIndexSnapshot();
  return [
    { id: 'channel-index.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createChannelIndexReadinessBoard(snapshot) },
    { id: 'channel-index.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'channel-index.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

