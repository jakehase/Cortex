import { buildLoyaltyLedgerSnapshot, createLoyaltyLedgerReadinessBoard } from '../service-loyalty-ledger.mjs';

export function createLoyaltyLedgerOpsRoutes(basePath = '/ops/loyalty-ledger') {
  const snapshot = buildLoyaltyLedgerSnapshot();
  return [
    { id: 'loyalty-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLoyaltyLedgerReadinessBoard(snapshot) },
    { id: 'loyalty-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'loyalty-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

