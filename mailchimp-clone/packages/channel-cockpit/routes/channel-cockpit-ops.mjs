import { buildChannelCockpitSnapshot, createChannelCockpitReadinessBoard } from '../service-channel-cockpit.mjs';

export function createChannelCockpitOpsRoutes(basePath = '/ops/channel-cockpit') {
  const snapshot = buildChannelCockpitSnapshot();
  return [
    { id: 'channel-cockpit.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createChannelCockpitReadinessBoard(snapshot) },
    { id: 'channel-cockpit.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'channel-cockpit.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

