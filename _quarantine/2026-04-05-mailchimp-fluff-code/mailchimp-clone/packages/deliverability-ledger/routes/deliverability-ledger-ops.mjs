import { buildDeliverabilityLedgerSnapshot, createDeliverabilityLedgerReadinessBoard } from '../service-deliverability-ledger.mjs';

export function createDeliverabilityLedgerOpsRoutes(basePath = '/ops/deliverability-ledger') {
  const snapshot = buildDeliverabilityLedgerSnapshot();
  return [
    { id: 'deliverability-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createDeliverabilityLedgerReadinessBoard(snapshot) },
    { id: 'deliverability-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'deliverability-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

