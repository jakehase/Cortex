import { buildChannelHubSnapshot, createChannelHubReadinessBoard } from '../service-channel-hub.mjs';

export function createChannelHubOpsRoutes(basePath = '/ops/channel-hub') {
  const snapshot = buildChannelHubSnapshot();
  return [
    { id: 'channel-hub.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createChannelHubReadinessBoard(snapshot) },
    { id: 'channel-hub.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'channel-hub.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

