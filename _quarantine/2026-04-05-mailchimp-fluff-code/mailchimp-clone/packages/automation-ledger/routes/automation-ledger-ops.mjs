import { buildAutomationLedgerSnapshot, createAutomationLedgerReadinessBoard } from '../service-automation-ledger.mjs';

export function createAutomationLedgerOpsRoutes(basePath = '/ops/automation-ledger') {
  const snapshot = buildAutomationLedgerSnapshot();
  return [
    { id: 'automation-ledger.ops.readiness', method: 'GET', path: basePath + '/readiness', checklist: createAutomationLedgerReadinessBoard(snapshot) },
    { id: 'automation-ledger.ops.exceptions', method: 'GET', path: basePath + '/exceptions', exceptions: snapshot.analytics.exceptions },
    { id: 'automation-ledger.ops.audit', method: 'GET', path: basePath + '/audit', audit: snapshot.audit }
  ];
}

