import { buildChannelAtlasSnapshot, createChannelAtlasReadinessBoard } from '../service-channel-atlas.mjs';

export function createChannelAtlasOpsRoutes(basePath = '/ops/channel-atlas') {
  const snapshot = buildChannelAtlasSnapshot();
  return [
    { id: 'channel-atlas.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createChannelAtlasReadinessBoard(snapshot) },
    { id: 'channel-atlas.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'channel-atlas.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

