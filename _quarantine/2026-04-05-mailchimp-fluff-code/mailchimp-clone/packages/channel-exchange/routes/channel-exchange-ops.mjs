import { buildChannelExchangeSnapshot, createChannelExchangeReadinessBoard } from '../service-channel-exchange.mjs';

export function createChannelExchangeOpsRoutes(basePath = '/ops/channel-exchange') {
  const snapshot = buildChannelExchangeSnapshot();
  return [
    { id: 'channel-exchange.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createChannelExchangeReadinessBoard(snapshot) },
    { id: 'channel-exchange.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'channel-exchange.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

