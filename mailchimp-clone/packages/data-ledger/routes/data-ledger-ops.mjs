import { buildDataLedgerSnapshot, createDataLedgerReadinessBoard } from '../service-data-ledger.mjs';

export function createDataLedgerOpsRoutes(basePath = '/ops/data-ledger') {
  const snapshot = buildDataLedgerSnapshot();
  return [
    { id: 'data-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDataLedgerReadinessBoard(snapshot) },
    { id: 'data-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'data-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

