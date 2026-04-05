import { buildAudienceLedgerSnapshot, createAudienceLedgerReadinessBoard } from '../service-audience-ledger.mjs';

export function createAudienceLedgerOpsRoutes(basePath = '/ops/audience-ledger') {
  const snapshot = buildAudienceLedgerSnapshot();
  return [
    { id: 'audience-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAudienceLedgerReadinessBoard(snapshot) },
    { id: 'audience-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'audience-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

