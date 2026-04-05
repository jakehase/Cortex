import { buildComplianceLedgerSnapshot, createComplianceLedgerReadinessBoard } from '../service-compliance-ledger.mjs';

export function createComplianceLedgerOpsRoutes(basePath = '/ops/compliance-ledger') {
  const snapshot = buildComplianceLedgerSnapshot();
  return [
    { id: 'compliance-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createComplianceLedgerReadinessBoard(snapshot) },
    { id: 'compliance-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'compliance-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

