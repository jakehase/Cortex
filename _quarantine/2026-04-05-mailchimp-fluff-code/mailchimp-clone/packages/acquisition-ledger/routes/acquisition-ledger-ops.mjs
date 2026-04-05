import { buildAcquisitionLedgerSnapshot, createAcquisitionLedgerReadinessBoard } from '../service-acquisition-ledger.mjs';

export function createAcquisitionLedgerOpsRoutes(basePath = '/ops/acquisition-ledger') {
  const snapshot = buildAcquisitionLedgerSnapshot();
  return [
    { id: 'acquisition-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAcquisitionLedgerReadinessBoard(snapshot) },
    { id: 'acquisition-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'acquisition-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

