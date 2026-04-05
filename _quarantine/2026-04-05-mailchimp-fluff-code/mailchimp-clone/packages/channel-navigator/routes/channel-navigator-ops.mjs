import { buildChannelNavigatorSnapshot, createChannelNavigatorReadinessBoard } from '../service-channel-navigator.mjs';

export function createChannelNavigatorOpsRoutes(basePath = '/ops/channel-navigator') {
  const snapshot = buildChannelNavigatorSnapshot();
  return [
    { id: 'channel-navigator.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createChannelNavigatorReadinessBoard(snapshot) },
    { id: 'channel-navigator.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'channel-navigator.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

