import { buildEcommerceLedgerSnapshot, createEcommerceLedgerReadinessBoard } from '../service-ecommerce-ledger.mjs';

export function createEcommerceLedgerOpsRoutes(basePath = '/ops/ecommerce-ledger') {
  const snapshot = buildEcommerceLedgerSnapshot();
  return [
    { id: 'ecommerce-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createEcommerceLedgerReadinessBoard(snapshot) },
    { id: 'ecommerce-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'ecommerce-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

