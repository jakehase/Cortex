import { buildChannelWatchtowerSnapshot, createChannelWatchtowerReadinessBoard } from '../service-channel-watchtower.mjs';

export function createChannelWatchtowerOpsRoutes(basePath = '/ops/channel-watchtower') {
  const snapshot = buildChannelWatchtowerSnapshot();
  return [
    { id: 'channel-watchtower.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createChannelWatchtowerReadinessBoard(snapshot) },
    { id: 'channel-watchtower.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'channel-watchtower.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

