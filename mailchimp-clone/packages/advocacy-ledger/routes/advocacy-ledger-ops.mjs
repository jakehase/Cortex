import { buildAdvocacyLedgerSnapshot, createAdvocacyLedgerReadinessBoard } from '../service-advocacy-ledger.mjs';

export function createAdvocacyLedgerOpsRoutes(basePath = '/ops/advocacy-ledger') {
  const snapshot = buildAdvocacyLedgerSnapshot();
  return [
    { id: 'advocacy-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAdvocacyLedgerReadinessBoard(snapshot) },
    { id: 'advocacy-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'advocacy-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

