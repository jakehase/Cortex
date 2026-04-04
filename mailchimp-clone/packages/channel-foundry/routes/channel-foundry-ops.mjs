import { buildChannelFoundrySnapshot, createChannelFoundryReadinessBoard } from '../service-channel-foundry.mjs';

export function createChannelFoundryOpsRoutes(basePath = '/ops/channel-foundry') {
  const snapshot = buildChannelFoundrySnapshot();
  return [
    { id: 'channel-foundry.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createChannelFoundryReadinessBoard(snapshot) },
    { id: 'channel-foundry.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'channel-foundry.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

