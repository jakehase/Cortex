import { buildBillingLedgerSnapshot, createBillingLedgerReadinessBoard } from '../service-billing-ledger.mjs';

export function createBillingLedgerOpsRoutes(basePath = '/ops/billing-ledger') {
  const snapshot = buildBillingLedgerSnapshot();
  return [
    { id: 'billing-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createBillingLedgerReadinessBoard(snapshot) },
    { id: 'billing-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'billing-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

