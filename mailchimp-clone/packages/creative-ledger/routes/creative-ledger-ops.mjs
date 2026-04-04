import { buildCreativeLedgerSnapshot, createCreativeLedgerReadinessBoard } from '../service-creative-ledger.mjs';

export function createCreativeLedgerOpsRoutes(basePath = '/ops/creative-ledger') {
  const snapshot = buildCreativeLedgerSnapshot();
  return [
    { id: 'creative-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCreativeLedgerReadinessBoard(snapshot) },
    { id: 'creative-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'creative-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

