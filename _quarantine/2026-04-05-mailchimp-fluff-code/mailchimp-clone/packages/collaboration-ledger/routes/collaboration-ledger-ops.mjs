import { buildCollaborationLedgerSnapshot, createCollaborationLedgerReadinessBoard } from '../service-collaboration-ledger.mjs';

export function createCollaborationLedgerOpsRoutes(basePath = '/ops/collaboration-ledger') {
  const snapshot = buildCollaborationLedgerSnapshot();
  return [
    { id: 'collaboration-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createCollaborationLedgerReadinessBoard(snapshot) },
    { id: 'collaboration-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'collaboration-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

