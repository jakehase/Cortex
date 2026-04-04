import { buildCustomerLedgerSnapshot, createCustomerLedgerReadinessBoard } from '../service-customer-ledger.mjs';

export function createCustomerLedgerOpsRoutes(basePath = '/ops/customer-ledger') {
  const snapshot = buildCustomerLedgerSnapshot();
  return [
    { id: 'customer-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCustomerLedgerReadinessBoard(snapshot) },
    { id: 'customer-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'customer-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

