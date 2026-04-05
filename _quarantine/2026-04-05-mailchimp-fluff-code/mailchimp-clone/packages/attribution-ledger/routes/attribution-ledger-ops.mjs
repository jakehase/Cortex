import { buildAttributionLedgerSnapshot, createAttributionLedgerReadinessBoard } from '../service-attribution-ledger.mjs';

export function createAttributionLedgerOpsRoutes(basePath = '/ops/attribution-ledger') {
  const snapshot = buildAttributionLedgerSnapshot();
  return [
    { id: 'attribution-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAttributionLedgerReadinessBoard(snapshot) },
    { id: 'attribution-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'attribution-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

