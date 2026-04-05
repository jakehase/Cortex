import { buildCommerceLedgerSnapshot, createCommerceLedgerReadinessBoard } from '../service-commerce-ledger.mjs';

export function createCommerceLedgerOpsRoutes(basePath = '/ops/commerce-ledger') {
  const snapshot = buildCommerceLedgerSnapshot();
  return [
    { id: 'commerce-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCommerceLedgerReadinessBoard(snapshot) },
    { id: 'commerce-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'commerce-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

