import { buildActivationLedgerSnapshot, createActivationLedgerReadinessBoard } from '../service-activation-ledger.mjs';

export function createActivationLedgerOpsRoutes(basePath = '/ops/activation-ledger') {
  const snapshot = buildActivationLedgerSnapshot();
  return [
    { id: 'activation-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createActivationLedgerReadinessBoard(snapshot) },
    { id: 'activation-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'activation-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

