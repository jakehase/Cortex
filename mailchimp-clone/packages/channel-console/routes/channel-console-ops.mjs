import { buildChannelConsoleSnapshot, createChannelConsoleReadinessBoard } from '../service-channel-console.mjs';

export function createChannelConsoleOpsRoutes(basePath = '/ops/channel-console') {
  const snapshot = buildChannelConsoleSnapshot();
  return [
    { id: 'channel-console.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createChannelConsoleReadinessBoard(snapshot) },
    { id: 'channel-console.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'channel-console.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

