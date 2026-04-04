import { buildChannelLedgerSnapshot, createChannelLedgerReadinessBoard } from '../service-channel-ledger.mjs';

export function createChannelLedgerOpsRoutes(basePath = '/ops/channel-ledger') {
  const snapshot = buildChannelLedgerSnapshot();
  return [
    { id: 'channel-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createChannelLedgerReadinessBoard(snapshot) },
    { id: 'channel-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'channel-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

