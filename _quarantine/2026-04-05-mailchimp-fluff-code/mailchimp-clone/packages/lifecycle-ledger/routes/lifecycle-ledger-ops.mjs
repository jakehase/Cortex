import { buildLifecycleLedgerSnapshot, createLifecycleLedgerReadinessBoard } from '../service-lifecycle-ledger.mjs';

export function createLifecycleLedgerOpsRoutes(basePath = '/ops/lifecycle-ledger') {
  const snapshot = buildLifecycleLedgerSnapshot();
  return [
    { id: 'lifecycle-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createLifecycleLedgerReadinessBoard(snapshot) },
    { id: 'lifecycle-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'lifecycle-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

