import { buildContentLedgerSnapshot, createContentLedgerReadinessBoard } from '../service-content-ledger.mjs';

export function createContentLedgerOpsRoutes(basePath = '/ops/content-ledger') {
  const snapshot = buildContentLedgerSnapshot();
  return [
    { id: 'content-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createContentLedgerReadinessBoard(snapshot) },
    { id: 'content-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'content-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

